import { atom, getDefaultStore, useAtom } from "jotai";
import { useEffect, useMemo, useState } from "react";
import type { PublicSsrTerminalSummary } from "shared/contracts/ssr";
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
const bulletinRefreshGenerationByTerminal = new Map<string, number>();

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

// refresh one terminal bulletin snapshot
export const refreshBulletins = async (
  terminalId: string
): Promise<TerminalBulletinResult> => {
  const refreshGeneration =
    (bulletinRefreshGenerationByTerminal.get(terminalId) ?? 0) + 1;
  bulletinRefreshGenerationByTerminal.set(terminalId, refreshGeneration);
  const result = await post<{ sourceUpdatedAt: number | null }>(
    "/terminals/bulletins/refresh",
    {}
  );
  const terminal = await get<Terminal>(getApiTerminal(terminalId));
  // cache only the latest-started refresh for this terminal
  if (
    bulletinRefreshGenerationByTerminal.get(terminalId) === refreshGeneration
  ) {
    terminalCache[terminalId] = terminal;
  }
  return { ...result, terminal };
};

interface TerminalState {
  terminals: Terminal[];
  closestTerminal: Terminal | null;
}

export interface TerminalDirectoryEntry {
  id: string;
  location: {
    latitude: number;
    longitude: number;
  };
  name: string;
}

interface TerminalDirectoryState {
  terminals: TerminalDirectoryEntry[];
  closestTerminal: TerminalDirectoryEntry | null;
}

const terminalsAtom = atom<Terminal[] | null>(null);

// refresh saved dock coordinates without leaving nested map mates stale
export const refreshTerminalLocations = async (
  terminalId: string
): Promise<void> => {
  const fresh = await get<Record<string, Terminal>>(API_TERMINALS);
  // refuse an incomplete directory refresh
  if (!fresh[terminalId]) {
    throw new Error("Terminal locations could not be refreshed");
  }
  // update mounted references before replacing the directory snapshot
  for (const cached of values(terminalCache)) {
    // refresh the selected terminal and every cached mate independently
    for (const terminal of [cached, ...(cached.mates ?? [])]) {
      const updated = fresh[terminal.id];
      // preserve unrelated cached terminals during a partial source update
      if (updated) {
        terminal.location = { ...updated.location };
      }
    }
  }
  Object.assign(terminalCache, fresh);
  hasAll = true;
  getDefaultStore().set(
    terminalsAtom,
    values(terminalCache).sort(compareTerminalsByName)
  );
};

const useTerminalSeed = (
  enabled: boolean
): PublicSsrTerminalSummary[] | undefined => {
  const seed = usePublicSsrSource("terminals");
  return enabled && seed ? [...seed] : undefined;
};

/**
 * Loads the canonical terminal list without reading or requesting a location.
 * Use this for features that need terminal metadata but must not participate in
 * the shared geolocation cache.
 */
export const useTerminalList = (): Terminal[] => {
  const [terminals, setTerminals] = useAtom(terminalsAtom);

  useEffect(() => {
    if (terminals) {
      return;
    }
    getTerminals()
      .then(setTerminals)
      .catch((error: unknown) => {
        // Keep the canonical value unresolved so directory-only consumers can
        // continue using their document seed after a transient API failure.
        console.error(error);
      });
  }, [setTerminals, terminals]);

  return terminals ?? [];
};

export function useTerminals(options: {
  usePublicDirectorySeed: true;
}): TerminalDirectoryState;
export function useTerminals(options?: {
  usePublicDirectorySeed?: false;
}): TerminalState;
export function useTerminals(
  options: { usePublicDirectorySeed?: boolean } = {}
): TerminalDirectoryState | TerminalState {
  const [location] = useGeo();
  const [terminals, setTerminals] = useAtom(terminalsAtom);
  const seed = useTerminalSeed(options.usePublicDirectorySeed === true);
  const visibleTerminals = terminals ?? seed;
  const [closestTerminal, setClosestTerminal] =
    useState<TerminalDirectoryState["closestTerminal"]>(null);

  // terminal list fetch
  const fetchTerminals = async (): Promise<void> => {
    try {
      setTerminals(await getTerminals());
    } catch (error) {
      // terminal fetch failure
      console.error(error);
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
    let closestTerminal: TerminalDirectoryEntry | undefined;
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

  const orderedTerminals = useMemo(
    () =>
      visibleTerminals && closestTerminal
        ? [...visibleTerminals].sort(getTerminalSorter(closestTerminal))
        : (visibleTerminals ?? []),
    [closestTerminal, visibleTerminals]
  );

  return { terminals: orderedTerminals, closestTerminal };
}
