import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";

import type { ProjectedTiming } from "./projectedTiming";

interface SailingDepartureOptions {
  slot: Slot;
  time: DateTime;
  timing: ProjectedTiming;
}

// identify a completed departure using live vessel state when available
export const hasSailingDeparted = ({
  slot,
  time,
  timing,
}: SailingDepartureOptions): boolean => {
  const { gpsDelay, isAtDock, scheduledDepartureTime } = slot.vessel ?? {};
  const liveDepartureTime =
    scheduledDepartureTime ?? gpsDelay?.signals.scheduledDepartureTime;
  const hasMatchingLiveLeg =
    !timing.isCancelled &&
    liveDepartureTime === slot.time &&
    typeof isAtDock === "boolean";
  // active sailing guard
  if (hasMatchingLiveLeg) {
    return !isAtDock;
  }
  return timing.departureTime.toMillis() < time.toMillis();
};
