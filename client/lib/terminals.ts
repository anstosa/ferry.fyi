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

export const refreshBulletins = async (
  terminalId: string
): Promise<{ sourceUpdatedAt: number | null; terminal: Terminal }> => {
  const result = await post<{ sourceUpdatedAt: number | null }>(
    "/terminals/bulletins/refresh",
    {}
  );
  const terminal = await get<Terminal>(getApiTerminal(terminalId));
  terminalCache[terminalId] = terminal;
  return { ...result, terminal };
};

export const getBulletinFreshness = (): Promise<{
  sourceUpdatedAt: number | null;
}> => get("/terminals/bulletins/freshness");

interface TerminalState {
  terminals: Terminal[];
  closestTerminal: Terminal | null;
}

const terminalsAtom = atom<Terminal[] | null>(null);

export const useTerminals = (): TerminalState => {
  const [location] = useGeo();
  const [terminals, setTerminals] = useAtom(terminalsAtom);
  const [closestTerminal, setClosestTerminal] =
    useState<TerminalState["closestTerminal"]>(null);

  // terminal list fetch
  const fetchTerminals = async (): Promise<void> => {
    try {
      setTerminals(await getTerminals());
    } catch (error) {
      // terminal fetch failure
      console.error(error);
      setTerminals([]);
    }
  };

  useEffect(() => {
    if (!terminals) {
      fetchTerminals();
    }
  }, []);

  useEffect(() => {
    // location readiness guard
    if (isNull(location) || !terminals || isEmpty(terminals)) {
      return;
    }
    let closestTerminal: Terminal | undefined;
    let closestDistance: number = Infinity;
    // compare terminal distance
    terminals.forEach((terminal) => {
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
  }, [location, terminals]);

  useEffect(() => {
    setTerminals([
      ...(terminals ?? []).sort(getTerminalSorter(closestTerminal)),
    ]);
  }, [closestTerminal]);

  return { terminals: terminals ?? [], closestTerminal };
};
