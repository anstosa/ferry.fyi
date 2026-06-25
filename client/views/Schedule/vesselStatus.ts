import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";
import { pluralize } from "shared/lib/strings";

// round eta minutes
export const getRoundedEtaMinutes = (
  estimatedArrivalTime: number | undefined,
  time: DateTime
): number | null => {
  // missing eta guard
  if (!estimatedArrivalTime) {
    return null;
  }
  const etaMins = DateTime.fromSeconds(estimatedArrivalTime)
    .diff(time)
    .as("minutes");
  return Math.max(0, Math.round(etaMins));
};

// round status number
export const roundStatusNumber = (value: number): number => Math.round(value);

interface IsAfterCurrentSlotOptions {
  currentSlot: Slot | null;
  schedule: Slot[];
  slot: Slot;
}

// future slot check
export const isAfterCurrentSlot = ({
  currentSlot,
  schedule,
  slot,
}: IsAfterCurrentSlotOptions): boolean => {
  // no current sailing guard
  if (!currentSlot) {
    return false;
  }
  const sortedSlots = [...schedule].sort(
    (left, right) => left.time - right.time
  );
  const currentIndex = sortedSlots.indexOf(currentSlot);
  const slotIndex = sortedSlots.indexOf(slot);
  return currentIndex >= 0 && slotIndex > currentIndex;
};

// forecast delay label
export const getForecastLateText = (delayMins: number): string | null => {
  // on-time guard
  if (delayMins <= 0) {
    return null;
  }
  return `Forecast ${pluralize(roundStatusNumber(delayMins), "min")} late`;
};
