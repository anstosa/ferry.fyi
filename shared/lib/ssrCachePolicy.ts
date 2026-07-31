import { DateTime } from "luxon";

export const SAILING_DAY_ZONE = "America/Los_Angeles";
export const SAILING_DAY_BOUNDARY_HOUR = 3;

export const getSailingDayId = (now: DateTime): string => {
  const local = now.setZone(SAILING_DAY_ZONE);
  const day =
    local.hour < SAILING_DAY_BOUNDARY_HOUR ? local.minus({ days: 1 }) : local;
  return day.toISODate() as string;
};

export const getNextSailingDayBoundary = (now: DateTime): DateTime => {
  const local = now.setZone(SAILING_DAY_ZONE);
  const boundaryDay =
    local.hour < SAILING_DAY_BOUNDARY_HOUR ? local : local.plus({ days: 1 });
  return DateTime.fromObject(
    {
      day: boundaryDay.day,
      hour: SAILING_DAY_BOUNDARY_HOUR,
      month: boundaryDay.month,
      year: boundaryDay.year,
    },
    { zone: SAILING_DAY_ZONE }
  );
};
