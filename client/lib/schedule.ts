import { get } from "~/lib/api";
import { GetScheduleResponse } from "shared/models/schedules";
import type { Terminal } from "shared/models/terminals";

const getApiSchedule = (departingId: number, arrivingId: number): string =>
  `/schedule/${departingId}/${arrivingId}`;

export const getSchedule = (
  terminal: Terminal,
  mate: Terminal
): Promise<GetScheduleResponse> => {
  return get<GetScheduleResponse>(getApiSchedule(terminal.id, mate.id));
};
