import { DateTime } from "luxon";
import type { Schedule } from "shared/contracts/schedules";

// identify the current pacific ferry service date
export const getRecommendationServiceDate = (seconds: number): string => {
  const now = DateTime.fromSeconds(seconds, { zone: "America/Los_Angeles" });
  return (now.hour < 3 ? now.minus({ days: 1 }) : now).toISODate() ?? "";
};

// serialize one versioned material schedule fingerprint without rider data
const serializeSailingRecommendationRevision = (
  schedule: Schedule,
  includeForecast: boolean
): string =>
  JSON.stringify([
    schedule.key,
    schedule.slots.map((slot) => {
      // capture timing and versioned inventory revisions
      return [
        slot.time,
        slot.arrivalTime ?? null,
        slot.hasPassed,
        slot.allowsPassengers,
        slot.allowsVehicles,
        slot.crossing?.isCancelled ?? false,
        slot.cancellationReason ?? null,
        slot.crossing?.departureDelta ?? null,
        slot.crossing?.capacityReportUpdatedAt ?? null,
        slot.crossing?.driveUpCapacity ?? null,
        slot.crossing?.reservableCapacity ?? null,
        slot.crossing?.totalCapacity ?? null,
        slot.estimate?.driveUpCapacity ?? null,
        slot.estimate?.reservableCapacity ?? null,
        ...(includeForecast ? [slot.estimate?.fullProbability ?? null] : []),
        slot.vessel?.id,
        slot.vessel?.name,
        slot.vessel?.horsepower ?? null,
        slot.vessel?.weight ?? null,
        slot.vessel?.vehicleCapacity ?? null,
        slot.vessel?.tallVehicleCapacity ?? null,
        slot.vessel?.isAtDock ?? null,
        slot.vessel?.departedTime ?? null,
        slot.vessel?.scheduledDepartureTime ?? null,
        slot.vessel?.departureDelta ?? null,
        slot.vessel?.gpsDelay?.delaySeconds ?? null,
        slot.vessel?.gpsDelay?.signals.scheduledDepartureTime ?? null,
      ];
    }),
  ]);

// preserve the exact pre-forecast material fingerprint
export const getLegacySailingRecommendationRevision = (
  schedule: Schedule
): string => serializeSailingRecommendationRevision(schedule, false);

// compare current material public schedule inputs
export const getSailingRecommendationRevision = (schedule: Schedule): string =>
  serializeSailingRecommendationRevision(schedule, true);

// preserve the freshest public capacity receipt
export const getCapacityWatermark = (schedule: Schedule): number | null => {
  const values = schedule.slots.map((slot) => {
    // collect finite capacity timestamps
    return slot.crossing?.capacityReportUpdatedAt ?? 0;
  });
  const watermark = Math.max(0, ...values.filter(Number.isFinite));
  return watermark > 0 ? watermark : null;
};
