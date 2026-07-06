import cors from "cors";
import express, { NextFunction, Request, Response } from "express";
import logger from "heroku-logger";
import { scheduleJob } from "node-schedule";

import { apiRouter } from "~/controllers/api";
import { staticRouter } from "~/controllers/static";
import { dbInit } from "~/lib/db";
import { updateMajorSportsEvents } from "~/lib/demandEvents/updateMajorSportsEvents";
import { updateSchoolBreakEvents } from "~/lib/demandEvents/updateSchoolBreakEvents";
import { safeScheduledTask } from "~/lib/safeScheduledJob";
import {
  initializeWsfSeed,
  refreshWsfInBackground,
  updateDaily,
  updateLong,
  updateScheduleCache,
  updateShort,
} from "~/lib/wsf";
import { Schedule } from "~/models/Schedule";

import { Route } from "./models/Route";

const STARTUP_MAINTENANCE_DELAY_MS = 60_000;

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
// mount routes
app.use("/api", apiRouter);
app.use("/", staticRouter);

// run demand event maintenance
const refreshDemandEventsInBackground = (): void => {
  Promise.all([updateMajorSportsEvents(), updateSchoolBreakEvents()]).catch(
    (error: Error) => {
      // log event failure
      logger.error(`Demand event refresh failed: ${error.message}`, error);
    }
  );
};

// defer noncritical startup work
const deferStartupMaintenance = (name: string, task: () => void): void => {
  const timeout = setTimeout(() => {
    logger.info(`Starting deferred startup maintenance: ${name}`);
    task();
  }, STARTUP_MAINTENANCE_DELAY_MS);
  timeout.unref();
};

// start server
(async () => {
  await dbInit;
  initializeWsfSeed();
  // start server before initializing WSF since that can take a couple minutes
  const server = app.listen(process.env.PORT, () =>
    logger.info(`Server started on port ${process.env.PORT ?? "default"}`)
  );
  process.once("SIGUSR2", () => {
    logger.info("Gracefully shutting down server...");
    server.close(() => {
      logger.info("Done.");
      process.kill(process.pid, "SIGUSR2");
    });
  });
  logger.info("Initializing WSF cache and background refresh jobs");
  // refresh WSF cache asynchronously
  refreshWsfInBackground();
  // defer demand event maintenance
  deferStartupMaintenance("demand events", refreshDemandEventsInBackground);
  // run daily inference after overnight cache reset
  scheduleJob(
    { hour: 4, minute: 10, second: 0 },
    safeScheduledTask("daily WSF route-vessel inference", updateDaily)
  );
  // refresh schedules after cache purge
  scheduleJob(
    { hour: 4, minute: 5, second: 0 },
    safeScheduledTask("daily WSF schedule refresh", updateScheduleCache)
  );
  // run slow updates every 5 minutes
  scheduleJob(
    { minute: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55], second: 0 },
    safeScheduledTask("long WSF refresh", updateLong)
  );
  // run fast updates every minute
  scheduleJob(
    { second: 0 },
    safeScheduledTask("short WSF refresh", updateShort)
  );
  // clear cache at 4am
  scheduleJob(
    { hour: 4, minute: 0, second: 0 },
    safeScheduledTask("daily in-memory cache purge", () => {
      Schedule.purge();
      Route.purge();
    })
  );
  // refresh demand events daily
  scheduleJob(
    { hour: 4, minute: 20, second: 0 },
    safeScheduledTask(
      "daily demand event refresh",
      refreshDemandEventsInBackground
    )
  );
  logger.info(
    "WSF refresh jobs scheduled: schedules daily 04:05, daily 04:10, " +
      "demand events daily 04:20, long every 5 minutes, short every minute"
  );
})();
