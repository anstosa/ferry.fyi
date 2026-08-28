import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";

import { hasSailingDeparted } from "./departureState";
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
    const timing = getProjectedTiming({
      schedule,
      slot: scheduleSlot,
    });
    // active departure guard
    if (!hasSailingDeparted({ slot: scheduleSlot, time, timing })) {
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
    const timing = getProjectedTiming({
      schedule,
      slot: previousSlot,
    });
    return hasSailingDeparted({ slot: previousSlot, time, timing });
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
