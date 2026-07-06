import { DateTime } from "luxon";
import { GetScheduleResponse } from "shared/api/schedules";
import type { Terminal } from "shared/contracts/terminals";

import { get } from "~/lib/api";

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

// schedule response guard
export const requireScheduleResponse = (
  response: GetScheduleResponse | undefined
): GetScheduleResponse => {
  // empty response guard
  if (!response) {
    throw new Error("Schedule response was empty");
  }
  return response;
};
