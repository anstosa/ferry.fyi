import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";
import { isNil, isNull } from "shared/lib/identity";
import { constrain, round } from "shared/lib/math";

const DELAY_RECOVERY_RATIO = 0.42;
const FULLNESS_RECOVERY_THRESHOLD = 70;
const FULLNESS_RECOVERY_PENALTY = 0.08;
const MAX_SPEED_RECOVERY_ADJUSTMENT = 2;
const REFERENCE_POWER_TO_WEIGHT = 2.4;
const REFERENCE_SAILING_MINUTES = 20;
const SAILING_RECOVERY_WEIGHT = 0.01;
const SPEED_RECOVERY_WEIGHT = 1.5;

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

// GPS delay minutes
const getGpsDelayMins = (slot: Slot): number | null => {
  const gpsDelay = slot.vessel?.gpsDelay;
  // matching GPS leg guard
  if (gpsDelay?.signals.scheduledDepartureTime !== slot.time) {
    return null;
  }
  const { delaySeconds } = gpsDelay;
  // missing GPS delay guard
  if (isNull(delaySeconds) || isNil(delaySeconds)) {
    return null;
  }
  return round(delaySeconds / 60);
};

// boat delay minutes
const getVesselDelayMins = (slot: Slot): number | null => {
  const departureDelta = slot.vessel?.departureDelta;
  // missing vessel delay guard
  if (isNull(departureDelta) || isNil(departureDelta)) {
    return null;
  }
  return round(departureDelta / 60);
};

// active delay minutes
const getActiveDelayMins = (slot: Slot): number => {
  const gpsDelayMins = getGpsDelayMins(slot);
  // authoritative GPS guard
  if (!isNull(gpsDelayMins)) {
    return Math.max(gpsDelayMins, 0);
  }
  const recordedDelayMins = getRecordedDelayMins(slot) ?? 0;
  const vesselDelayMins = getVesselDelayMins(slot) ?? 0;
  return Math.max(recordedDelayMins, vesselDelayMins, 0);
};

// slot forecast fullness percent
export const getSlotFullness = (slot: Slot): number | null => {
  const { crossing, estimate, vessel } = slot;
  // actual fullness first
  if (crossing && slot.hasPassed) {
    const spacesLeft = crossing.driveUpCapacity + crossing.reservableCapacity;
    return (
      ((crossing.totalCapacity - spacesLeft) / crossing.totalCapacity) * 100
    );
  }
  // future forecast fallback
  if (!slot.hasPassed && estimate) {
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
  const gpsDelaySlot = schedule.find((scheduleSlot) => {
    // matching GPS slot
    return !isNull(getGpsDelayMins(scheduleSlot));
  });
  // active GPS guard
  if (gpsDelaySlot) {
    return gpsDelaySlot;
  }
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
  const recoveryMins = getDelayRecoveryMins(delayMins, slot);
  return Math.max(0, delayMins - recoveryMins);
};

// scheduled sailing minutes
const getScheduledSailingMins = (slot: Slot): number => {
  const { arrivalTime } = slot;
  // missing arrival guard
  if (!arrivalTime) {
    return REFERENCE_SAILING_MINUTES;
  }
  return Math.max(0, (arrivalTime - slot.time) / 60);
};

// vessel recovery adjustment
const getSpeedRecoveryMins = (slot: Slot): number => {
  const { horsepower, weight } = slot.vessel;
  // missing capability guard
  if (!horsepower || !weight) {
    return 0;
  }
  const powerToWeight = horsepower / weight;
  return constrain(
    (powerToWeight - REFERENCE_POWER_TO_WEIGHT) * SPEED_RECOVERY_WEIGHT,
    -MAX_SPEED_RECOVERY_ADJUSTMENT,
    MAX_SPEED_RECOVERY_ADJUSTMENT
  );
};

// fullness recovery penalty
const getFullnessRecoveryPenaltyMins = (slot: Slot): number => {
  const fullness = getSlotFullness(slot);
  // missing fullness guard
  if (isNull(fullness)) {
    return 0;
  }
  return Math.max(
    0,
    (fullness - FULLNESS_RECOVERY_THRESHOLD) * FULLNESS_RECOVERY_PENALTY
  );
};

// predicted delay recovery
export const getDelayRecoveryMins = (delayMins: number, slot: Slot): number => {
  // no active delay guard
  if (delayMins <= 0) {
    return 0;
  }
  const sailingRecovery =
    (getScheduledSailingMins(slot) - REFERENCE_SAILING_MINUTES) *
    SAILING_RECOVERY_WEIGHT;
  const rawRecovery =
    delayMins * DELAY_RECOVERY_RATIO +
    sailingRecovery +
    getSpeedRecoveryMins(slot) -
    getFullnessRecoveryPenaltyMins(slot);
  return round(constrain(rawRecovery, 0, delayMins));
};

// vessel-scoped slots
const getVesselScopedSlots = (schedule: Slot[], slot: Slot): Slot[] => {
  const vesselId = slot.vessel?.id;
  // missing vessel guard
  if (!vesselId) {
    return [slot];
  }
  return schedule.filter((scheduleSlot) => {
    // same vessel match
    return scheduleSlot.vessel?.id === vesselId;
  });
};

// projected delay for slot
export const getProjectedDelayMins = ({
  schedule,
  slot,
}: ProjectedTimingOptions): number => {
  const sortedSlots = getVesselScopedSlots(schedule, slot).sort(
    (left, right) => left.time - right.time
  );
  const currentDelaySlot = getCurrentDelaySlot(sortedSlots);
  const currentDelayMins = currentDelaySlot
    ? getActiveDelayMins(currentDelaySlot)
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
  const gpsDelayMins = getGpsDelayMins(slot);
  const delayMins = slot.hasPassed
    ? (gpsDelayMins ?? recordedDelayMins ?? 0)
    : getProjectedDelayMins({ schedule, slot });
  return {
    delayMins,
    departureTime: scheduledTime.plus({ minutes: delayMins }),
    isCancelled: slot.crossing?.isCancelled ?? false,
    scheduledTime,
  };
};
