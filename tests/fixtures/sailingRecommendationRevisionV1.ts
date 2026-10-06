// frozen production v1 fingerprint from 64ad1f90579975619f6842e01cb94d0664c5f251
// preserve the exact tuple order without the future forecast-probability column
import type { Schedule } from "shared/contracts/schedules";

// compare material public schedule inputs without rider data
export const getSailingRecommendationRevision = (schedule: Schedule): string =>
  JSON.stringify([
    schedule.key,
    schedule.slots.map((slot) => {
      // capture timing and inventory revisions
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
