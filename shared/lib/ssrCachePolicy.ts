import { DateTime } from "luxon";

export const SAILING_DAY_ZONE = "America/Los_Angeles";
export const SAILING_DAY_BOUNDARY_HOUR = 3;

export const getSailingDayId = (now: DateTime): string => {
  const local = now.setZone(SAILING_DAY_ZONE);
  const day =
    local.hour < SAILING_DAY_BOUNDARY_HOUR ? local.minus({ days: 1 }) : local;
  return day.toISODate() as string;
};
