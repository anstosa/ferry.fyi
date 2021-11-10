import { entries, findKey, keys, values } from "shared/lib/objects";
import { get } from "~/lib/api";
import { sortBy } from "shared/lib/arrays";
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
