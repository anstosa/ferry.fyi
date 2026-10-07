import { DateTime } from "luxon";

export const SSR_REFRESH_WINDOW_ZONE = "America/Los_Angeles";
export const SSR_REFRESH_WINDOW_HOURS = [3, 15] as const;

export interface SsrRefreshWindow {
  readonly classification: "03:00" | "15:00";
  readonly end: Date;
  readonly id: string;
  readonly start: Date;
}

// normalize a runtime instant to pacific time
const asPacific = (now: Date | DateTime): DateTime =>
  (now instanceof Date ? DateTime.fromJSDate(now) : now).setZone(
    SSR_REFRESH_WINDOW_ZONE
  );

// build one local calendar boundary
const boundary = (day: DateTime, hour: 3 | 15): DateTime =>
  DateTime.fromObject(
    { day: day.day, hour, month: day.month, year: day.year },
    { zone: SSR_REFRESH_WINDOW_ZONE }
  );

/** Resolves the fixed 03:00/15:00 Pacific document refresh window. */
export const getSsrRefreshWindow = (now: Date | DateTime): SsrRefreshWindow => {
  const local = asPacific(now);
  let start: DateTime;
  let end: DateTime;
  // use yesterday's afternoon window before 03:00
  if (local.hour < SSR_REFRESH_WINDOW_HOURS[0]) {
    start = boundary(local.minus({ days: 1 }), SSR_REFRESH_WINDOW_HOURS[1]);
    end = boundary(local, SSR_REFRESH_WINDOW_HOURS[0]);
  } else if (local.hour < SSR_REFRESH_WINDOW_HOURS[1]) {
    // use today's morning window before 15:00
    start = boundary(local, SSR_REFRESH_WINDOW_HOURS[0]);
    end = boundary(local, SSR_REFRESH_WINDOW_HOURS[1]);
  } else {
    // use today's afternoon window through tomorrow morning
    start = boundary(local, SSR_REFRESH_WINDOW_HOURS[1]);
    end = boundary(local.plus({ days: 1 }), SSR_REFRESH_WINDOW_HOURS[0]);
  }
  return {
    classification: start.hour === 3 ? "03:00" : "15:00",
    end: end.toJSDate(),
    id: start.toFormat("yyyy-MM-dd'T'HH:mm"),
    start: start.toJSDate(),
  };
};
