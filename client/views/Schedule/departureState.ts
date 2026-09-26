import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";
import { isValidDepartureObservation } from "shared/lib/projectedTiming";

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
  const { departedTime, gpsDelay, isAtDock, scheduledDepartureTime } =
    slot.vessel ?? {};
  const liveDepartureTime =
    scheduledDepartureTime ?? gpsDelay?.signals.scheduledDepartureTime;
  const hasMatchingLiveLeg =
    !timing.isCancelled &&
    liveDepartureTime === slot.time &&
    (!Number.isFinite(departedTime) ||
      isValidDepartureObservation(departedTime, slot.time, time.toSeconds())) &&
    typeof isAtDock === "boolean";
  // active sailing guard
  if (hasMatchingLiveLeg) {
    return !isAtDock;
  }
  return timing.departureTime.toMillis() < time.toMillis();
};
