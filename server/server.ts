import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import logger from "heroku-logger";
import morgan from "morgan";
import { scheduleJob } from "node-schedule";

import { apiRouter } from "~/controllers/api";
import { staticRouter } from "~/controllers/static";
import { dbInit } from "~/lib/db";
import { backfillWeatherObservations } from "~/lib/weather/backfill";
import { calculateAndPersistWeatherAdjustments } from "~/lib/weather/calculateCapacityAdjustments";
import {
  initializeWsfSeed,
  refreshWsfInBackground,
  updateLong,
  updateShort,
} from "~/lib/wsf";
import { Schedule } from "~/models/Schedule";

import { Route } from "./models/Route";

const forceHttps = (
  request: Request,
  response: Response,
  next: NextFunction
): void => {
  const protocol = request.get("x-forwarded-proto") || request.protocol;
  // https redirect guard
  if (protocol !== "https") {
    response.redirect(
      301,
      `https://${request.get("host")}${request.originalUrl}`
    );
    return;
  }
  next();
};

// start main app
const app = express();
// use SSL in production
if (process.env.NODE_ENV === "production") {
  app.use(forceHttps);
}
app.use(express.json());
app.use(cors());
// log requests
app.use(morgan("combined"));
// mount routes
app.use("/api", apiRouter);
app.use("/", staticRouter);

// run startup weather maintenance
const refreshWeatherModelInBackground = (): void => {
  backfillWeatherObservations({ chunkDays: 90 })
    .then((backfillReport) => {
      // report backfill result
      logger.info(
        `Weather backfill complete: ${backfillReport.recordsWritten} records written, ` +
          `${backfillReport.skippedChunks} chunks skipped`
      );
    })
    .catch((error: Error) => {
      // log backfill failure
      logger.error(`Weather startup backfill failed: ${error.message}`, error);
    })
    .then(() => calculateAndPersistWeatherAdjustments())
    .then((calculationReport) => {
      // report calculation result
      logger.info(
        `Weather adjustment calculation complete: ${calculationReport.rowsWritten} ` +
          `rows written from ${calculationReport.rowsCalculated} calculated rows`
      );
    })
    .catch((error: Error) => {
      // log calculation failure
      logger.error(
        `Weather startup calculation failed: ${error.message}`,
        error
      );
    });
};

// start server
(async () => {
  await dbInit;
  initializeWsfSeed();
  // start server before initializing WSF since that can take a couple minutes
  const server = app.listen(process.env.PORT, () =>
    logger.info("Server started")
  );
  process.once("SIGUSR2", () => {
    logger.info("Gracefully shutting down server...");
    server.close(() => {
      logger.info("Done.");
      process.kill(process.pid, "SIGUSR2");
    });
  });
  logger.info("Initializing WSF");
  // refresh WSF cache asynchronously
  refreshWsfInBackground();
  // refresh weather model asynchronously
  refreshWeatherModelInBackground();
  // run slow updates every minute
  scheduleJob({ second: 0 }, updateLong);
  // run fast updates every 30 seconds
  scheduleJob({ second: [0, 30] }, updateShort);
  // clear cache at 4am
  scheduleJob({ hour: 4, minute: 0, second: 0 }, () => {
    Schedule.purge();
    Route.purge();
  });
  logger.info("WSF Initialized");
})();
