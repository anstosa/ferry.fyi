import path from "node:path";
import { Worker } from "node:worker_threads";

import type {
  Crossing as CrossingContract,
  CrossingEstimate,
  Schedule as PublicScheduleContract,
  Slot as PublicSlotContract,
  SlotTide,
  SlotWeather,
} from "shared/contracts/schedules";

import { updateEstimates } from "~/lib/forecast";
import type { Schedule } from "~/models/Schedule";

export interface ForecastSlotSnapshot {
  estimate?: CrossingEstimate;
  tide?: SlotTide;
  time: number;
  weather?: SlotWeather;
}

export interface ForecastScheduleSnapshot {
  key: string;
  slots: ForecastSlotSnapshot[];
}

export interface ForecastCrossingInput extends CrossingContract {
  capacityReportingStartedAt: number | null;
}

export interface ForecastSlotInput extends Omit<
  PublicSlotContract,
  "crossing"
> {
  crossing?: ForecastCrossingInput;
}

export interface ForecastScheduleInput extends Omit<
  PublicScheduleContract,
  "slots"
> {
  slots: ForecastSlotInput[];
}

export interface ForecastWorkerData {
  schedules: ForecastScheduleInput[];
}

interface ForecastWorkerSuccess {
  snapshots: ForecastScheduleSnapshot[];
  type: "success";
}

interface ForecastWorkerFailure {
  error: string;
  type: "failure";
}

export type ForecastWorkerResponse =
  | ForecastWorkerFailure
  | ForecastWorkerSuccess;

// serialize one private worker crossing
const serializeForecastCrossing = (
  crossing: CrossingContract & {
    capacityReportingStartedAt?: number | null;
  }
): ForecastCrossingInput => ({
  arrivalId: crossing.arrivalId,
  capacityReportUpdatedAt: crossing.capacityReportUpdatedAt ?? null,
  capacityReportingStartedAt: Number.isFinite(
    crossing.capacityReportingStartedAt
  )
    ? (crossing.capacityReportingStartedAt as number)
    : null,
  departureDelta: crossing.departureDelta,
  departureId: crossing.departureId,
  departureTime: crossing.departureTime,
  driveUpCapacity: crossing.driveUpCapacity,
  hasDriveUp: crossing.hasDriveUp,
  hasReservations: crossing.hasReservations,
  isCancelled: crossing.isCancelled,
  reservableCapacity: crossing.reservableCapacity,
  totalCapacity: crossing.totalCapacity,
  vesselId: crossing.vesselId ?? null,
  vesselName: crossing.vesselName ?? null,
});

// normalize one private worker schedule
export const normalizeForecastScheduleInput = (
  schedule: Omit<PublicScheduleContract, "slots"> & {
    slots: Array<
      Omit<PublicSlotContract, "crossing"> & {
        crossing?: CrossingContract & {
          capacityReportingStartedAt?: number | null;
        };
      }
    >;
  }
): ForecastScheduleInput => ({
  date: schedule.date,
  key: schedule.key,
  mateId: schedule.mateId,
  slots: schedule.slots.map((slot) => ({
    allowsPassengers: slot.allowsPassengers,
    allowsVehicles: slot.allowsVehicles,
    hasPassed: slot.hasPassed,
    mateId: slot.mateId,
    time: slot.time,
    vessel: { ...slot.vessel },
    wuid: slot.wuid,
    // retain forecast-owned optional slot data
    ...(Number.isFinite(slot.arrivalTime)
      ? { arrivalTime: slot.arrivalTime }
      : {}),
    ...(slot.cancellationReason
      ? { cancellationReason: slot.cancellationReason }
      : {}),
    ...(slot.crossing
      ? { crossing: serializeForecastCrossing(slot.crossing) }
      : {}),
    ...(slot.estimate ? { estimate: { ...slot.estimate } } : {}),
    ...(slot.tide ? { tide: { ...slot.tide } } : {}),
    ...(Number.isFinite(slot.vesselPosition)
      ? { vesselPosition: slot.vesselPosition }
      : {}),
    ...(slot.weather ? { weather: { ...slot.weather } } : {}),
  })),
  terminalId: schedule.terminalId,
  validRange: schedule.validRange
    ? { from: schedule.validRange.from, to: schedule.validRange.to }
    : null,
  // retain schedule freshness privately
  ...(Number.isFinite(schedule.sourceUpdatedAt) ||
  schedule.sourceUpdatedAt === null
    ? { sourceUpdatedAt: schedule.sourceUpdatedAt }
    : {}),
});

// serialize mutable schedules for the private worker boundary
export const serializeForecastSchedules = (
  schedules: Schedule[]
): ForecastScheduleInput[] => schedules.map(normalizeForecastScheduleInput);

// capture only forecast fields returned by the worker
export const createForecastSnapshots = (
  schedules: Schedule[]
): ForecastScheduleSnapshot[] => {
  return schedules.map((schedule) => ({
    key: schedule.key,
    slots: schedule.slots.map((slot) => ({
      estimate: slot.estimate,
      tide: slot.tide,
      time: slot.time,
      weather: slot.weather,
    })),
  }));
};

// merge worker results into the live schedule cache
export const applyForecastSnapshots = (
  schedules: Schedule[],
  snapshots: ForecastScheduleSnapshot[]
): void => {
  const snapshotsByKey = new Map(
    snapshots.map((snapshot) => [snapshot.key, snapshot])
  );
  // merge matching schedules
  schedules.forEach((schedule) => {
    const snapshot = snapshotsByKey.get(schedule.key);
    // stale schedule guard
    if (!snapshot) {
      return;
    }
    const slotsByTime = new Map(
      snapshot.slots.map((slot) => [slot.time, slot])
    );
    // merge matching sailing forecasts
    schedule.slots.forEach((slot) => {
      const forecast = slotsByTime.get(slot.time);
      // stale sailing guard
      if (!forecast) {
        return;
      }
      slot.estimate = forecast.estimate;
      slot.tide = forecast.tide;
      slot.weather = forecast.weather;
    });
  });
};

// resolve beside the bundled server entry rather than a shared chunk
const getForecastWorkerPath = (): string => {
  const serverEntryPath = process.argv[1];
  // direct runtime fallback
  if (!serverEntryPath) {
    return path.resolve(process.cwd(), "forecast-worker.js");
  }
  return path.resolve(path.dirname(serverEntryPath), "forecast-worker.js");
};

// execute forecast calculation outside the request event loop
const runForecastWorker = async (
  schedules: Schedule[]
): Promise<ForecastScheduleSnapshot[]> => {
  const workerPath = getForecastWorkerPath();
  const workerData: ForecastWorkerData = {
    schedules: serializeForecastSchedules(schedules),
  };
  return await new Promise<ForecastScheduleSnapshot[]>((resolve, reject) => {
    const worker = new Worker(workerPath, { workerData });
    let receivedResponse = false;
    worker.once("message", (response: ForecastWorkerResponse) => {
      receivedResponse = true;
      // worker failure guard
      if (response.type === "failure") {
        reject(new Error(response.error));
        return;
      }
      resolve(response.snapshots);
    });
    worker.once("error", reject);
    worker.once("exit", (code) => {
      // completed response guard
      if (receivedResponse) {
        return;
      }
      reject(new Error(`Forecast worker exited before responding (${code})`));
    });
  });
};

// isolate production forecast CPU while preserving direct test execution
export const updateEstimatesIsolated = async (
  schedules: Schedule[]
): Promise<void> => {
  // local execution guard
  if (process.env.NODE_ENV !== "production") {
    await updateEstimates(schedules);
    return;
  }
  const snapshots = await runForecastWorker(schedules);
  applyForecastSnapshots(schedules, snapshots);
};
