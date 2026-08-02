import { DateTime } from "luxon";
import { GetScheduleResponse } from "shared/api/schedules";
import type { Terminal } from "shared/contracts/terminals";

import { ApiError, get, post } from "~/lib/api";

const SCHEDULE_REFRESH_RETRY_COUNT = 12;
const SCHEDULE_REFRESH_RETRY_DELAY_MS = 1000;

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
  const path = getApiSchedule(terminal.id, mate.id, date);
  return getScheduleWithRefreshRetry(path);
};

/** Reads the server's current schedule cache without requesting recalculation. */
export const refreshSchedule = (
  terminal: Terminal,
  mate: Terminal,
  date?: DateTime
): Promise<GetScheduleResponse> =>
  post<GetScheduleResponse>(getApiSchedule(terminal.id, mate.id, date), {});

// schedule refresh status guard
const isScheduleRefreshing = (error: unknown): boolean => {
  if (!(error instanceof ApiError) || error.status !== 503) {
    return false;
  }
  const { data } = error;
  if (
    data &&
    typeof data === "object" &&
    "status" in data &&
    (data as { status?: unknown }).status === "refreshing"
  ) {
    return true;
  }
  return Boolean(
    data &&
    typeof data === "object" &&
    "body" in data &&
    (data as { body?: unknown }).body &&
    typeof (data as { body?: unknown }).body === "object" &&
    (data as { body: { status?: unknown } }).body.status === "refreshing"
  );
};

// refresh retry wait
const waitForScheduleRefresh = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, SCHEDULE_REFRESH_RETRY_DELAY_MS);
  });

// fetch a schedule while its server refresh completes
const getScheduleWithRefreshRetry = async (
  path: string
): Promise<GetScheduleResponse> => {
  for (let attempt = 0; attempt <= SCHEDULE_REFRESH_RETRY_COUNT; attempt += 1) {
    try {
      return await get<GetScheduleResponse>(path);
    } catch (error) {
      if (
        !isScheduleRefreshing(error) ||
        attempt === SCHEDULE_REFRESH_RETRY_COUNT
      ) {
        throw error;
      }
      await waitForScheduleRefresh();
    }
  }
  throw new Error("Schedule refresh retry limit reached");
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

/** Epoch seconds when Ferry FYI last checked this schedule response. */
export const getScheduleCheckedAt = (
  response: GetScheduleResponse
): number | null =>
  Number.isFinite(response.timestamp) ? response.timestamp : null;
