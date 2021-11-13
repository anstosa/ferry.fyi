import { DateTime } from "luxon";
import { get } from "~/lib/api";
import { GetScheduleResponse } from "shared/api/schedules";
import type { Terminal } from "shared/contracts/terminals";

const getApiSchedule = (
  departingId: string,
  arrivingId: string,
  date: DateTime = DateTime.local()
): string => `/schedule/${departingId}/${arrivingId}/${date.toISODate()}`;

export const getSchedule = (
  terminal: Terminal,
  mate: Terminal,
  date?: DateTime
): Promise<GetScheduleResponse> => {
  return get<GetScheduleResponse>(getApiSchedule(terminal.id, mate.id, date));
};
