import { DateTime } from "luxon";
import type { Route } from "shared/contracts/routes";
import type { Slot } from "shared/contracts/schedules";

interface GalleyStatusOptions {
  currentTime?: DateTime;
  route?: Route;
  sailingTime: DateTime;
  schedule?: Slot[];
  slot: Slot;
}

interface ScheduledWindowOptions {
  currentTime?: DateTime;
  schedule?: Slot[];
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

// same vessel schedule check
const isSameScheduledVessel = (slot: Slot, candidate: Slot): boolean => {
  // vessel id guard
  if (slot.vessel?.id && candidate.vessel?.id) {
    return String(slot.vessel.id) === String(candidate.vessel.id);
  }
  return (
    Boolean(slot.vesselPosition) &&
    Number(slot.vesselPosition) === Number(candidate.vesselPosition)
  );
};

// scheduled service window check
const isOutsideScheduledWindow = ({
  currentTime,
  schedule,
  slot,
}: ScheduledWindowOptions): boolean => {
  // docked current-day guard
  if (
    !slot.vessel?.isAtDock ||
    !currentTime ||
    !schedule ||
    currentTime.toISODate() !== DateTime.fromSeconds(slot.time).toISODate()
  ) {
    return false;
  }
  const vesselSlots = schedule.filter((candidate) => {
    // matching vessel schedule
    return isSameScheduledVessel(slot, candidate);
  });
  // schedule data guard
  if (vesselSlots.length === 0) {
    return false;
  }
  const currentSeconds = currentTime.toSeconds();
  const firstDeparture = Math.min(
    ...vesselSlots.map(({ time }) => {
      // collect departure time
      return time;
    })
  );
  const lastArrival = Math.max(
    ...vesselSlots.map(({ arrivalTime, time }) => {
      // collect arrival time
      return arrivalTime ?? time;
    })
  );
  return currentSeconds < firstDeparture || currentSeconds > lastArrival;
};

// resolve galley status
export const getGalleyStatus = ({
  currentTime,
  route,
  sailingTime,
  schedule,
  slot,
}: GalleyStatusOptions): GalleyStatus => {
  const { galleyHours } = route ?? {};
  // service window guard
  if (isOutsideScheduledWindow({ currentTime, schedule, slot })) {
    return "closed";
  }
  // missing hours guard
  if (!galleyHours || !slot.vesselPosition) {
    return "unknown";
  }
  const day = sailingTime.weekday;
  const minuteOfDay = sailingTime.hour * 60 + sailingTime.minute;
  const matchingRules = galleyHours.filter(({ days, vesselPosition }) => {
    // matching schedule guard
    return (
      Number(vesselPosition) === Number(slot.vesselPosition) &&
      days.includes(day)
    );
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
