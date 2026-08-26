import path from "node:path";
import { Worker } from "node:worker_threads";

import type {
  CrossingEstimate,
  Schedule as ScheduleContract,
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

export interface ForecastWorkerData {
  schedules: ScheduleContract[];
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

// serialize mutable schedules for the worker boundary
export const serializeForecastSchedules = (
  schedules: Schedule[]
): ScheduleContract[] => {
  return schedules.map((schedule) => {
    return JSON.parse(JSON.stringify(schedule.serialize())) as ScheduleContract;
  });
};

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
