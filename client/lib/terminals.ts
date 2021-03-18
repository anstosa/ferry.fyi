import { findKey } from "~/lib/objects";
import { get } from "~/lib/api";
import { isString } from "~/lib/strings";
import { sortBy } from "~/lib/arrays";
import type { Terminal } from "shared/models/terminals";

const TERMINAL_ALIASES: Record<string, number> = {
  ana: 1,
  bbi: 3,
  bre: 4,
  cli: 5,
  cou: 11,
  cpv: 11,
  edm: 8,
  fau: 9,
  fdh: 10,
  frh: 10,
  fri: 10,
  fhb: 10,
  key: 11,
  kin: 12,
  lop: 13,
  lpz: 13,
  muk: 14,
  orc: 15,
  ori: 15,
  p52: 7,
  poi: 16,
  por: 17,
  pot: 17,
  ptd: 16,
  sdy: 19,
  sea: 7,
  sha: 18,
  shi: 18,
  sid: 19,
  sou: 20,
  sth: 20,
  tah: 21,
  vai: 22,
  vas: 22,
  vsh: 22,
  bainbridgeisland: 3,
  fridayharbor: 10,
  lopezisland: 13,
  orcasisland: 15,
  pointdefiance: 16,
  porttownsend: 17,
  sidneybc: 19,
  vashonisland: 22,
  shawisland: 18,
};

const CANONICAL_TERMINALS: Record<string, number> = {
  anacortes: 1,
  bainbridge: 3,
  bremerton: 4,
  clinton: 5,
  coupeville: 11,
  defiance: 16,
  edmonds: 8,
  fauntleroy: 9,
  friday: 10,
  kingston: 12,
  lopez: 13,
  mukilteo: 14,
  orcas: 15,
  seattle: 7,
  shaw: 18,
  sidney: 19,
  southworth: 20,
  tahlequah: 21,
  townsend: 17,
  vashon: 22,
};

const TERMINAL_ID_BY_SLUG = {
  ...CANONICAL_TERMINALS,
  ...TERMINAL_ALIASES,
};

export const slugs = Object.keys(TERMINAL_ID_BY_SLUG);

const API_TERMINALS = "/terminals";
const getApiTerminal = (id: number): string => `/terminals/${id}`;

let hasAll = false;
const terminalCache: Record<number, Terminal> = {};

export const getSlug = (targetId: number): string =>
  findKey(CANONICAL_TERMINALS, targetId) as string;

// get terminal data by slug or id
// loads from cache if possible
export const getTerminal = async (key: string | number): Promise<Terminal> => {
  let id: number;
  if (isString(key)) {
    id = TERMINAL_ID_BY_SLUG[String(key).toLowerCase()];
  } else {
    id = Number(key);
  }
  let terminal: Terminal = terminalCache?.[id];
  if (!terminal) {
    terminal = ((await get(getApiTerminal(id))) as unknown) as Terminal;
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
  return sortBy(Object.values(terminalCache), "name");
};
