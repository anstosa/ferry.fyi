import { DateTime } from "luxon";
import type { Slot } from "shared/contracts/schedules";
import { EARLY_DEPARTURE_TOLERANCE_SECONDS } from "shared/lib/projectedTiming";

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
      ((departedTime as number) >=
        slot.time - EARLY_DEPARTURE_TOLERANCE_SECONDS &&
        (departedTime as number) <= time.toSeconds())) &&
    typeof isAtDock === "boolean";
  // active sailing guard
  if (hasMatchingLiveLeg) {
    return !isAtDock;
  }
  return timing.departureTime.toMillis() < time.toMillis();
};
