import { atom, useAtom } from "jotai";
import { entries, findKey, keys, values } from "shared/lib/objects";
import { get } from "~/lib/api";
import { getDistance, Point, useGeo } from "./geo";
import { isEmpty, sortBy } from "shared/lib/arrays";
import { isNull } from "shared/lib/identity";
import { useEffect, useState } from "react";
import TERMINAL_DATA_OVERRIDES from "shared/data/terminals.json";
import type { Terminal } from "shared/contracts/terminals";

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
  return sortBy(values(terminalCache), "name");
};

interface TerminalState {
  terminals: Terminal[];
  closestTerminal: Terminal | null;
}

export const getTerminalSorter =
  (closestTerminal?: Terminal | null) =>
  (a: Terminal, b: Terminal): number => {
    if (a.id === closestTerminal?.id) {
      return -1;
    } else if (b.id === closestTerminal?.id) {
      return 1;
    } else {
      return b.popularity - a.popularity;
    }
  };

const terminalsAtom = atom<Terminal[] | null>(null);

export const useTerminals = (withGeo?: boolean): TerminalState => {
  let location: Point | null = null;
  if (withGeo) {
    location = useGeo();
  }

  const [terminals, setTerminals] = useAtom(terminalsAtom);
  const [closestTerminal, setClosestTerminal] =
    useState<TerminalState["closestTerminal"]>(null);

  const fetchTerminals = async (): Promise<void> => {
    setTerminals(await getTerminals());
  };

  useEffect(() => {
    if (!terminals) {
      fetchTerminals();
    }
  }, []);

  useEffect(() => {
    if (isNull(location) || !terminals || isEmpty(terminals)) {
      return;
    }
    let closestTerminal: Terminal | undefined;
    let closestDistance: number = Infinity;
    terminals.forEach((terminal) => {
      const { latitude, longitude } = terminal.location;
      if (!latitude || !longitude) {
        return;
      }
      const distance = getDistance(location as Point, { latitude, longitude });
      if (distance < closestDistance) {
        closestDistance = distance;
        closestTerminal = terminal;
      }
      if (closestTerminal) {
        setClosestTerminal(closestTerminal);
      }
    });
  }, [location, terminals]);

  useEffect(() => {
    setTerminals([
      ...(terminals ?? []).sort(getTerminalSorter(closestTerminal)),
    ]);
  }, [closestTerminal]);

  return { terminals: terminals ?? [], closestTerminal };
};
