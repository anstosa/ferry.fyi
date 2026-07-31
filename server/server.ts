import cors from "cors";
import express from "express";
import logger from "heroku-logger";
import { scheduleJob } from "node-schedule";

import { apiRouter } from "~/controllers/api";
import { createStaticRouter, staticRouter } from "~/controllers/static";
import {
  type AdminOperationName,
  runAdminOperation,
} from "~/lib/admin/operations";
import { dbInit } from "~/lib/db";
import { safeScheduledTask } from "~/lib/safeScheduledJob";
import {
  forceHttps,
  healthRouter,
  shouldRunScheduler,
} from "~/lib/serverRuntime";
import { initializeWsfSeed } from "~/lib/wsf";
import { loadProductionSsrArtifacts } from "~/ssr/artifacts";
import { createSsrRuntime } from "~/ssr/composition";

const STARTUP_MAINTENANCE_DELAY_MS = 60_000;

// create main app
export function createApp({
  apiHandler = apiRouter,
  staticHandler = staticRouter,
  publicMiddleware,
  webMiddleware,
}: {
  apiHandler?: express.RequestHandler;
  staticHandler?: express.RequestHandler;
  /** Dynamic policy documents that must precede Vite in development. */
  publicMiddleware?: express.RequestHandler;
  webMiddleware?: express.RequestHandler;
} = {}): express.Express {
  const app = express();
  app.use(healthRouter);
  // use SSL in production
  if (process.env.NODE_ENV === "production") {
    app.use(forceHttps);
  }
  app.use(express.json());
  app.use(cors());
  // mount routes
  app.use("/api", apiHandler);
  if (publicMiddleware) {
    app.use(publicMiddleware);
  }
  if (webMiddleware) {
    app.use(webMiddleware);
  }
  app.use("/", staticHandler);
  return app;
}

// Scheduled and startup work shares the owner-admin registry.  Besides making
// status truthful, this gives every process the same database lease as a
// manual action, so a deploy/startup cannot overlap an admin refresh.
const runOperationInBackground = async (
  operation: AdminOperationName
): Promise<void> => {
  const result = await runAdminOperation(operation);
  if (!result.started) {
    logger.info(
      `Skipped ${operation}; ${result.operation.operation} is already running`
    );
  } else if (result.operation.status === "failed") {
    logger.error(`Scheduled operation failed: ${operation}`);
  }
};

const beginOperationInBackground = (operation: AdminOperationName): void => {
  runOperationInBackground(operation).catch((error: unknown) => {
    logger.error(`Scheduled operation could not start: ${operation}`, {
      error,
    });
  });
};

function scheduleTodayFareCatalogWarmup(): void {
  scheduleJob(
    { hour: 0, minute: 5, second: 0, tz: "America/Los_Angeles" },
    safeScheduledTask("daily fare catalog warmup", () =>
      runOperationInBackground("fare-catalog-refresh")
    )
  );
}

// defer noncritical startup work
function deferStartupMaintenance(
  name: string,
  task: () => Promise<void> | void
): void {
  const timeout = setTimeout(() => {
    logger.info(`Starting deferred startup maintenance: ${name}`);
    Promise.resolve(task()).catch((error: unknown) => {
      logger.error(`Deferred startup maintenance failed: ${name}`, { error });
    });
  }, STARTUP_MAINTENANCE_DELAY_MS);
  timeout.unref();
}

// start web-safe WSF cache work
export function startWsfCacheRefreshJobs(): void {
  logger.info("Initializing WSF cache refresh jobs");
  // warm web caches
  beginOperationInBackground("wsf-refresh");
  deferStartupMaintenance("fare catalog cache", () =>
    runOperationInBackground("fare-catalog-refresh")
  );
  scheduleTodayFareCatalogWarmup();
  // refresh schedules after cache purge
  scheduleJob(
    { hour: 4, minute: 5, second: 0 },
    safeScheduledTask("daily WSF schedule refresh", () =>
      runOperationInBackground("schedule-refresh")
    )
  );
  // run slow updates every 5 minutes
  scheduleJob(
    { minute: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55], second: 0 },
    safeScheduledTask("long WSF refresh", () =>
      runOperationInBackground("wsf-long-refresh")
    )
  );
  // run fast cache updates every minute
  scheduleJob(
    { second: 0 },
    safeScheduledTask("short WSF cache refresh", () =>
      runOperationInBackground("wsf-short-refresh")
    )
  );
  // clear cache at 4am
  scheduleJob(
    { hour: 4, minute: 0, second: 0 },
    safeScheduledTask("daily in-memory cache purge", () =>
      runOperationInBackground("clear-wsf-memory-cache")
    )
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
  beginOperationInBackground("wsf-notifying-refresh");
  deferStartupMaintenance("fare catalog cache", () =>
    runOperationInBackground("fare-catalog-refresh")
  );
  scheduleTodayFareCatalogWarmup();
  // defer demand event maintenance
  deferStartupMaintenance("demand events", () =>
    runOperationInBackground("demand-events-refresh")
  );
  // defer detector warmup
  deferStartupMaintenance("camera line detection", () =>
    runOperationInBackground("camera-line-detection-refresh")
  );
  // run daily inference after overnight cache reset
  scheduleJob(
    { hour: 4, minute: 10, second: 0 },
    safeScheduledTask("daily WSF route-vessel inference", () =>
      runOperationInBackground("wsf-daily-refresh")
    )
  );
  // Recheck a bounded batch hourly; visitors never trigger a cache stampede.
  scheduleJob(
    { minute: 15, second: 0 },
    safeScheduledTask("hourly fare catalog cache refresh", () =>
      runOperationInBackground("fare-catalog-refresh")
    )
  );
  // refresh schedules after cache purge
  scheduleJob(
    { hour: 4, minute: 5, second: 0 },
    safeScheduledTask("daily WSF schedule refresh", () =>
      runOperationInBackground("schedule-refresh")
    )
  );
  // run slow updates every 5 minutes
  scheduleJob(
    { minute: [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55], second: 0 },
    safeScheduledTask("long WSF refresh", () =>
      runOperationInBackground("wsf-long-refresh")
    )
  );
  // run fast updates every minute
  scheduleJob(
    { second: 0 },
    safeScheduledTask("short WSF refresh", () =>
      runOperationInBackground("wsf-short-notifying-refresh")
    )
  );
  // refresh line detection cache every minute
  scheduleJob(
    { second: 30 },
    safeScheduledTask("camera line detection refresh", () =>
      runOperationInBackground("camera-line-detection-refresh")
    )
  );
  // clear cache at 4am
  scheduleJob(
    { hour: 4, minute: 0, second: 0 },
    safeScheduledTask("daily in-memory cache purge", () =>
      runOperationInBackground("clear-wsf-memory-cache")
    )
  );
  // refresh demand events daily
  scheduleJob(
    { hour: 4, minute: 20, second: 0 },
    safeScheduledTask("daily demand event refresh", () =>
      runOperationInBackground("demand-events-refresh")
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
  const artifacts = await loadProductionSsrArtifacts(__dirname);
  const documentRuntime = await createSsrRuntime({ artifacts });
  const app = createApp({
    staticHandler: createStaticRouter(undefined, {
      browserDependencies: { documentRuntime },
    }),
  });
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
  // scheduler ownership guard
  if (shouldRunScheduler()) {
    startScheduler();
    return;
  }
  startWsfCacheRefreshJobs();
  logger.info("Scheduler-only WSF jobs disabled for this process");
}
