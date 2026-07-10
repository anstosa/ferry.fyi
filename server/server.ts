import cors from "cors";
import express from "express";
import logger from "heroku-logger";
import { scheduleJob } from "node-schedule";

import { apiRouter } from "~/controllers/api";
import { staticRouter } from "~/controllers/static";
import { refreshCameraLineDetectionCache } from "~/lib/cameraLineDetection";
import { dbInit } from "~/lib/db";
import { updateMajorSportsEvents } from "~/lib/demandEvents/updateMajorSportsEvents";
import { updateSchoolBreakEvents } from "~/lib/demandEvents/updateSchoolBreakEvents";
import { safeScheduledTask } from "~/lib/safeScheduledJob";
import {
  forceHttps,
  healthRouter,
  shouldRunScheduler,
} from "~/lib/serverRuntime";
import {
  initializeWsfSeed,
  refreshWsfInBackground,
  updateDaily,
  updateLong,
  updateScheduleCache,
  updateShort,
  updateUserFacingStatus,
} from "~/lib/wsf";
import { Schedule } from "~/models/Schedule";

import { Route } from "./models/Route";

const STARTUP_MAINTENANCE_DELAY_MS = 60_000;

// create main app
export function createApp(): express.Express {
  const app = express();
  app.use(healthRouter);
  // use SSL in production
  if (process.env.NODE_ENV === "production") {
    app.use(forceHttps);
  }
  app.use(express.json());
  app.use(cors());
  // mount routes
  app.use("/api", apiRouter);
  app.use("/", staticRouter);
  return app;
}

// run demand event maintenance
function refreshDemandEventsInBackground(): void {
  Promise.all([updateMajorSportsEvents(), updateSchoolBreakEvents()]).catch(
    (error: Error) => {
      // log event failure
      logger.error(`Demand event refresh failed: ${error.message}`, error);
    }
  );
}

// warm public line-detection cache
function refreshCameraLineDetectionsInBackground(): void {
  refreshCameraLineDetectionCache().catch((error: Error) => {
    // log cache refresh failure
    logger.error(
      `Camera line detection refresh failed: ${error.message}`,
      error
    );
  });
}

// defer noncritical startup work
function deferStartupMaintenance(name: string, task: () => void): void {
  const timeout = setTimeout(() => {
    logger.info(`Starting deferred startup maintenance: ${name}`);
    task();
  }, STARTUP_MAINTENANCE_DELAY_MS);
  timeout.unref();
}

// start web-safe WSF cache work
export function startWsfCacheRefreshJobs(): void {
  logger.info("Initializing WSF cache refresh jobs");
  // warm web caches
  refreshWsfInBackground({ sendNotifications: false });
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
  // run fast cache updates every minute
  scheduleJob(
    { second: 0 },
    safeScheduledTask("short WSF cache refresh", updateUserFacingStatus)
  );
  // clear cache at 4am
  scheduleJob(
    { hour: 4, minute: 0, second: 0 },
    safeScheduledTask("daily in-memory cache purge", () => {
      Schedule.purge();
      Route.purge();
    })
  );
  logger.info(
    "WSF cache refresh jobs scheduled: schedules daily 04:05, " +
      "long every 5 minutes, short every minute"
  );
}

// start scheduler work
export function startScheduler(): void {
  logger.info("Initializing WSF scheduler jobs");
  // warm scheduler caches
  refreshWsfInBackground({ sendNotifications: true });
  // defer demand event maintenance
  deferStartupMaintenance("demand events", refreshDemandEventsInBackground);
  // defer detector warmup
  deferStartupMaintenance(
    "camera line detection",
    refreshCameraLineDetectionsInBackground
  );
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
  // refresh line detection cache every minute
  scheduleJob(
    { second: 30 },
    safeScheduledTask(
      "camera line detection refresh",
      refreshCameraLineDetectionCache
    )
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
      "demand events daily 04:20, long every 5 minutes, short every minute, " +
      "camera detection every minute"
  );
}

// start server
export async function startServer(): Promise<void> {
  await dbInit;
  initializeWsfSeed();
  const app = createApp();
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
  // scheduler ownership guard
  if (shouldRunScheduler()) {
    startScheduler();
    return;
  }
  startWsfCacheRefreshJobs();
  logger.info("Scheduler-only WSF jobs disabled for this process");
}

// test import guard
if (process.env.NODE_ENV !== "test") {
  startServer().catch((error: Error) => {
    logger.error(`Server startup failed: ${error.message}`, error);
    process.exit(1);
  });
}
