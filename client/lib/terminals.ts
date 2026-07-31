import { atom, useAtom } from "jotai";
import { useEffect, useState } from "react";
import type { Terminal } from "shared/contracts/terminals";
import TERMINAL_DATA_OVERRIDES from "shared/data/terminals.json";
import { isEmpty } from "shared/lib/arrays";
import { isNull } from "shared/lib/identity";
import { entries, findKey, keys, values } from "shared/lib/objects";
import {
  compareTerminalsByName,
  getTerminalSorter,
} from "shared/lib/terminalSorting";

import { get, post } from "~/lib/api";

import { getDistance, Point, useGeo } from "./geo";
import { usePublicSsrSource } from "./ssrSeed";

// create mapping of terminal ids to slugs
const terminalIdByCanonicalSlug: Record<string, string> = {};
const terminalIdBySlug = entries(TERMINAL_DATA_OVERRIDES).reduce<
  Record<string, string>
>((memo, [id, { slug, aliases }]) => {
  memo[slug] = id;
  terminalIdByCanonicalSlug[slug] = id;
  aliases.forEach((alias) => (memo[alias] = id));
  return memo;
}, {});

export const slugs = keys(terminalIdBySlug);

const API_TERMINALS = "/terminals";
const getApiTerminal = (id: string): string => `/terminals/${id}`;

let hasAll = false;
const terminalCache: Record<string, Terminal> = {};

export const getSlug = (targetId: string): string =>
  findKey(terminalIdByCanonicalSlug, targetId) as string;

// get terminal data by slug or id
// loads from cache if possible
export const getTerminal = async (key: string): Promise<Terminal> => {
  let id: string = key.toLowerCase();
  if (id in terminalIdBySlug) {
    id = terminalIdBySlug[id];
  }
  let terminal: Terminal = terminalCache?.[id];
  if (!terminal) {
    terminal = await get<Terminal>(getApiTerminal(id));
    // eslint-disable-next-line require-atomic-updates
    terminalCache[id] = terminal;
  }
  return terminal;
};

export const getTerminals = async (): Promise<Terminal[]> => {
  if (!hasAll) {
    Object.assign(terminalCache, await get(API_TERMINALS));
    // eslint-disable-next-line require-atomic-updates
    hasAll = true;
  }
  // alphabetical display order
  return values(terminalCache).sort(compareTerminalsByName);
};

export interface TerminalBulletinResult {
  sourceUpdatedAt: number | null;
  terminal: Terminal;
}

export const refreshBulletins = async (
  terminalId: string
): Promise<TerminalBulletinResult> => {
  const result = await post<{ sourceUpdatedAt: number | null }>(
    "/terminals/bulletins/refresh",
    {}
  );
  const terminal = await get<Terminal>(getApiTerminal(terminalId));
  terminalCache[terminalId] = terminal;
  return { ...result, terminal };
};

interface TerminalState {
  terminals: Terminal[];
  closestTerminal: Terminal | null;
}

const terminalsAtom = atom<Terminal[] | null>(null);

/**
 * Loads the canonical terminal list without reading or requesting a location.
 * Use this for features that need terminal metadata but must not participate in
 * the shared geolocation cache.
 */
export const useTerminalList = (): Terminal[] => {
  const [terminals, setTerminals] = useAtom(terminalsAtom);
  const seed = usePublicSsrSource("terminals") as Terminal[] | undefined;
  const visibleTerminals = terminals ?? seed;

  useEffect(() => {
    if (terminals) {
      return;
    }
    getTerminals()
      .then(setTerminals)
      .catch((error: unknown) => {
        // Terminal metadata remains available to location-free callers even
        // when the API is temporarily unavailable.
        console.error(error);
        if (!seed) {
          setTerminals([]);
        }
      });
  }, [seed, setTerminals, terminals]);

  return visibleTerminals ?? [];
};

export const useTerminals = (): TerminalState => {
  const [location] = useGeo();
  const [terminals, setTerminals] = useAtom(terminalsAtom);
  const seed = usePublicSsrSource("terminals") as Terminal[] | undefined;
  const visibleTerminals = terminals ?? seed;
  const [closestTerminal, setClosestTerminal] =
    useState<TerminalState["closestTerminal"]>(null);

  // terminal list fetch
  const fetchTerminals = async (): Promise<void> => {
    try {
      setTerminals(await getTerminals());
    } catch (error) {
      // terminal fetch failure
      console.error(error);
      // Retain document terminals when an anonymous post-commit refresh fails.
      if (!seed) {
        setTerminals([]);
      }
    }
  };

  useEffect(() => {
    // A snapshot is only first-render data. Refresh through the existing
    // anonymous endpoint after commit without clearing the visible seed.
    if (!terminals) {
      fetchTerminals();
    }
  }, []);

  useEffect(() => {
    // location readiness guard
    if (isNull(location) || !visibleTerminals || isEmpty(visibleTerminals)) {
      return;
    }
    let closestTerminal: Terminal | undefined;
    let closestDistance: number = Infinity;
    // compare terminal distance
    visibleTerminals.forEach((terminal) => {
      const { latitude, longitude } = terminal.location;
      // coordinate guard
      if (!latitude || !longitude) {
        return;
      }
      const distance = getDistance(location as Point, { latitude, longitude });
      // nearer terminal guard
      if (distance < closestDistance) {
        closestDistance = distance;
        closestTerminal = terminal;
      }
    });
    // closest terminal guard
    if (closestTerminal) {
      setClosestTerminal(closestTerminal);
    }
  }, [location, visibleTerminals]);

  useEffect(() => {
    setTerminals(
      [...(visibleTerminals ?? [])].sort(getTerminalSorter(closestTerminal))
    );
  }, [closestTerminal]);

  return { terminals: visibleTerminals ?? [], closestTerminal };
};
