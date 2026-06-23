import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";

import { getProjectedTiming } from "./projectedTiming";

interface ShouldRenderNowDividerOptions {
  schedule: Slot[];
  slot: Slot;
  time: DateTime;
}

// next departure slot
export const getCurrentSlot = (
  schedule: Slot[],
  time: DateTime
): Slot | null => {
  const sortedSlots = [...schedule].sort(
    (left, right) => left.time - right.time
  );
  // current slot search
  for (const scheduleSlot of sortedSlots) {
    const { departureTime } = getProjectedTiming({
      schedule,
      slot: scheduleSlot,
    });
    // future departure guard
    if (departureTime.toMillis() >= time.toMillis()) {
      return scheduleSlot;
    }
  }
  return null;
};

// previous departure check
const hasPreviousDeparture = (
  schedule: Slot[],
  slot: Slot,
  time: DateTime
): boolean => {
  const sortedSlots = [...schedule].sort(
    (left, right) => left.time - right.time
  );
  const slotIndex = sortedSlots.indexOf(slot);
  // first sailing guard
  if (slotIndex <= 0) {
    return false;
  }
  // prior sailing search
  return sortedSlots.slice(0, slotIndex).some((previousSlot) => {
    const { departureTime } = getProjectedTiming({
      schedule,
      slot: previousSlot,
    });
    return departureTime.toMillis() < time.toMillis();
  });
};

// identify current boundary
export const shouldRenderNowDivider = ({
  schedule,
  slot,
  time,
}: ShouldRenderNowDividerOptions): boolean => {
  const currentSlot = getCurrentSlot(schedule, time);
  // only next sailing
  if (slot !== currentSlot) {
    return false;
  }

  // require previous departure
  if (!hasPreviousDeparture(schedule, slot, time)) {
    return false;
  }

  return true;
};
