import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";
import { isNil, isNull } from "shared/lib/identity";
import { round } from "shared/lib/math";

const RECOVERY_MINUTES = 5;
const FULLNESS_RECOVERY_THRESHOLD = 70;

export interface ProjectedTiming {
  delayMins: number;
  departureTime: DateTime;
  isCancelled: boolean;
  scheduledTime: DateTime;
}

interface ProjectedTimingOptions {
  schedule: Slot[];
  slot: Slot;
}

// recorded delay minutes
export const getRecordedDelayMins = (slot: Slot): number | null => {
  const { departureDelta } = slot.crossing ?? {};
  // missing delay guard
  if (isNull(departureDelta) || isNil(departureDelta)) {
    return null;
  }
  return round(departureDelta / 60);
};

// slot forecast fullness percent
export const getSlotFullness = (slot: Slot): number | null => {
  const { crossing, estimate, vessel } = slot;
  // forecast fullness first
  if (estimate) {
    const totalCapacity = vessel.vehicleCapacity - vessel.tallVehicleCapacity;
    const spacesLeft =
      estimate.driveUpCapacity + (estimate.reservableCapacity ?? 0);
    return ((totalCapacity - spacesLeft) / totalCapacity) * 100;
  }
  // live fullness fallback
  if (crossing) {
    const spacesLeft = crossing.driveUpCapacity + crossing.reservableCapacity;
    return (
      ((crossing.totalCapacity - spacesLeft) / crossing.totalCapacity) * 100
    );
  }
  return null;
};

// current delay anchor
const getCurrentDelaySlot = (schedule: Slot[]): Slot | null => {
  // find current sailing
  for (const scheduleSlot of schedule) {
    // future sailing guard
    if (!scheduleSlot.hasPassed) {
      return scheduleSlot;
    }
  }
  return null;
};

// recover delay after sailing
const getRecoveredDelayMins = (delayMins: number, slot: Slot): number => {
  const fullness = getSlotFullness(slot);
  // no active delay guard
  if (delayMins <= 0) {
    return delayMins;
  }
  // crowded sailing guard
  if (!isNull(fullness) && fullness > FULLNESS_RECOVERY_THRESHOLD) {
    return delayMins;
  }
  return Math.max(0, delayMins - RECOVERY_MINUTES);
};

// projected delay for slot
export const getProjectedDelayMins = ({
  schedule,
  slot,
}: ProjectedTimingOptions): number => {
  const sortedSlots = [...schedule].sort(
    (left, right) => left.time - right.time
  );
  const currentDelaySlot = getCurrentDelaySlot(sortedSlots);
  const currentDelayMins = currentDelaySlot
    ? (getRecordedDelayMins(currentDelaySlot) ?? 0)
    : 0;
  let projectedDelayMins = Math.max(0, currentDelayMins);

  // schedule sequence
  for (const scheduleSlot of sortedSlots) {
    // target slot guard
    if (scheduleSlot === slot) {
      return currentDelaySlot ? projectedDelayMins : 0;
    }
    // current sailing guard
    if (scheduleSlot === currentDelaySlot) {
      projectedDelayMins = getRecoveredDelayMins(
        projectedDelayMins,
        scheduleSlot
      );
    } else if (currentDelaySlot && scheduleSlot.time > currentDelaySlot.time) {
      // later sailing recovery
      projectedDelayMins = getRecoveredDelayMins(
        projectedDelayMins,
        scheduleSlot
      );
    }
  }
  return 0;
};

// projected timing object
export const getProjectedTiming = ({
  schedule,
  slot,
}: ProjectedTimingOptions): ProjectedTiming => {
  const scheduledTime = DateTime.fromSeconds(slot.time);
  const recordedDelayMins = getRecordedDelayMins(slot);
  const delayMins = slot.hasPassed
    ? (recordedDelayMins ?? 0)
    : getProjectedDelayMins({ schedule, slot });
  return {
    delayMins,
    departureTime: scheduledTime.plus({ minutes: delayMins }),
    isCancelled: slot.crossing?.isCancelled ?? false,
    scheduledTime,
  };
};
