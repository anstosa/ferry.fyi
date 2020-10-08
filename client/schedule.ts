import { get } from "./lib/api";
import { Terminal } from "../server/lib/terminals";

const getApiSchedule = (departingId: number, arrivingId: number): string =>
  `/schedule/${departingId}/${arrivingId}`;

export const getSchedule = (
  terminal: Terminal,
  mate: Terminal
): Promise<Record<string, unknown>> => {
  return get(getApiSchedule(terminal.id, mate.id));
};
