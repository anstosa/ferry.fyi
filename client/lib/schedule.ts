import { get } from "~/lib/api";
import { GetScheduleResponse } from "shared/api/schedules";
import type { Terminal } from "shared/contracts/terminals";

const getApiSchedule = (departingId: string, arrivingId: string): string =>
  `/schedule/${departingId}/${arrivingId}`;

export const getSchedule = (
  terminal: Terminal,
  mate: Terminal
): Promise<GetScheduleResponse> => {
  return get<GetScheduleResponse>(getApiSchedule(terminal.id, mate.id));
};
