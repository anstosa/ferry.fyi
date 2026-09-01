import { parentPort, workerData } from "node:worker_threads";

import { db, dbInit } from "~/lib/db";
import { updateEstimates } from "~/lib/forecast";
import {
  createForecastSnapshots,
  type ForecastWorkerData,
  type ForecastWorkerResponse,
  normalizeForecastScheduleInput,
} from "~/lib/forecastIsolation";
import { hydrateWsfSeed } from "~/lib/wsf/seed";
import { Schedule } from "~/models/Schedule";

// send one worker result to the web process
const postResult = (response: ForecastWorkerResponse): void => {
  // parent availability guard
  if (!parentPort) {
    throw new Error("Forecast worker has no parent port");
  }
  parentPort.postMessage(response);
};

// calculate forecasts on an isolated event loop
const runForecastWorker = async (): Promise<void> => {
  const data = workerData as ForecastWorkerData;
  await dbInit;
  hydrateWsfSeed();
  const schedules = data.schedules.map(
    (schedule) => new Schedule(normalizeForecastScheduleInput(schedule))
  );
  await updateEstimates(schedules);
  postResult({
    snapshots: createForecastSnapshots(schedules),
    type: "success",
  });
};

runForecastWorker()
  .catch((error: unknown) => {
    // return actionable worker failures
    postResult({
      error: error instanceof Error ? error.message : String(error),
      type: "failure",
    });
  })
  .finally(async () => {
    // close worker database pool
    await db.close();
  });
