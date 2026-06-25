import { DateTime } from "luxon";
import type { Route } from "shared/contracts/routes";
import type { Slot } from "shared/contracts/schedules";

interface GalleyStatusOptions {
  route?: Route;
  sailingTime: DateTime;
  slot: Slot;
}

export type GalleyStatus = "closed" | "open" | "unknown";

// convert time string
const getMinuteOfDay = (time: string): number => {
  const [hour, minute] = time.split(":").map((part) => {
    // parse time part
    return Number(part);
  });
  return hour * 60 + minute;
};

// compare minute range
const isMinuteInRange = (
  minuteOfDay: number,
  startMinute: number,
  endMinute: number
): boolean => {
  // overnight range guard
  if (endMinute < startMinute) {
    return minuteOfDay >= startMinute || minuteOfDay <= endMinute;
  }
  return minuteOfDay >= startMinute && minuteOfDay <= endMinute;
};

// resolve galley status
export const getGalleyStatus = ({
  route,
  sailingTime,
  slot,
}: GalleyStatusOptions): GalleyStatus => {
  const { galleyHours } = route ?? {};
  // missing hours guard
  if (!galleyHours || !slot.vesselPosition) {
    return "unknown";
  }
  const day = sailingTime.weekday;
  const minuteOfDay = sailingTime.hour * 60 + sailingTime.minute;
  const matchingRules = galleyHours.filter(({ days, vesselPosition }) => {
    // matching schedule guard
    return vesselPosition === slot.vesselPosition && days.includes(day);
  });
  // no matching day guard
  if (matchingRules.length === 0) {
    return "closed";
  }
  const isOpen = matchingRules.some(({ startTime, endTime }) => {
    // open range check
    return isMinuteInRange(
      minuteOfDay,
      getMinuteOfDay(startTime),
      getMinuteOfDay(endTime)
    );
  });
  return isOpen ? "open" : "closed";
};
