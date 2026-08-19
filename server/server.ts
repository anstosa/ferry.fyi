import express from "express";
import logger from "heroku-logger";
import {
  type JobCallback,
  scheduleJob as createScheduledJob,
  type Spec,
} from "node-schedule";

import { apiRouter, automaticLeaderboardNativeRouter } from "~/controllers/api";
import { createStaticRouter, staticRouter } from "~/controllers/static";
import { createAdReportRouter } from "~/controllers/static/adReports";
import {
  type AdminOperationName,
  runAdminOperation,
} from "~/lib/admin/operations";
import { db, dbInit } from "~/lib/db";
import { apiErrorHandler } from "~/lib/httpApiPolicy";
import { httpCachePolicy } from "~/lib/httpCachePolicy";
import { createHttpSecurityMiddleware } from "~/lib/httpSecurity";
import { createHttpTelemetryMiddleware } from "~/lib/httpTelemetry";
import {
  reportOperationTelemetry,
  reportRuntimeLifecycleTelemetry,
} from "~/lib/operationTelemetry";
import { safeScheduledTask } from "~/lib/safeScheduledJob";
import {
  attachProcessSignalHandlers,
  BackgroundRegistry,
  createServerLifecycle,
} from "~/lib/serverLifecycle";
import {
  createHealthRouter,
  createReadinessController,
  forceHttps,
  type ReadinessController,
  shouldRunScheduler,
} from "~/lib/serverRuntime";
import { initializeWsfSeed } from "~/lib/wsf";
import { pruneExpiredLeaderboardAutomaticCandidateReceipts } from "~/services/leaderboardAutomaticCandidateReceipts";
import { cleanupAutomaticEnrollments } from "~/services/leaderboardAutomaticEnrollment";
import { pruneAutomaticTerminalConfigs } from "~/services/leaderboardAutomaticNativeConfig";
import { loadProductionSsrArtifacts } from "~/ssr/artifacts";
import { createSsrRuntime } from "~/ssr/composition";

const STARTUP_MAINTENANCE_DELAY_MS = 60_000;
export const serverBackgroundRegistry = new BackgroundRegistry();
const scheduleJob = (spec: Spec, callback: JobCallback) =>
  serverBackgroundRegistry.trackJob(createScheduledJob(spec, callback));

type AutomaticLeaderboardCleanupOutcome = "completed" | "failed";

/** fixed cleanup step result */
export interface AutomaticLeaderboardCleanupStepResult {
  count: number;
  outcome: AutomaticLeaderboardCleanupOutcome;
}

/** fixed cleanup lifecycle result */
export interface AutomaticLeaderboardCleanupResult {
  configs: AutomaticLeaderboardCleanupStepResult;
  enrollments: AutomaticLeaderboardCleanupStepResult;
  receipts: AutomaticLeaderboardCleanupStepResult;
}

/** injectable cleanup lifecycle */
export interface AutomaticLeaderboardCleanupDependencies {
  cleanupConfigs: () => Promise<number>;
  cleanupEnrollments: () => Promise<number>;
  cleanupReceipts: () => Promise<number>;
}

const defaultAutomaticCleanup: AutomaticLeaderboardCleanupDependencies = {
  cleanupConfigs: pruneAutomaticTerminalConfigs,
  cleanupEnrollments: cleanupAutomaticEnrollments,
  cleanupReceipts: pruneExpiredLeaderboardAutomaticCandidateReceipts,
};

// isolate one cleanup dependency
const runAutomaticLeaderboardCleanupStep = async (
  task: () => Promise<number>
): Promise<AutomaticLeaderboardCleanupStepResult> => {
  // reduce failures to fixed telemetry
  try {
    return { count: await task(), outcome: "completed" };
  } catch {
    return { count: 0, outcome: "failed" };
  }
};

// prune automatic state in dependency order
export const runAutomaticLeaderboardCleanup = async (
  deps: AutomaticLeaderboardCleanupDependencies = defaultAutomaticCleanup
): Promise<AutomaticLeaderboardCleanupResult> => {
  const receipts = await runAutomaticLeaderboardCleanupStep(
    deps.cleanupReceipts
  );
  const enrollments = await runAutomaticLeaderboardCleanupStep(
    deps.cleanupEnrollments
  );
  const configs = await runAutomaticLeaderboardCleanupStep(deps.cleanupConfigs);
  const result = { configs, enrollments, receipts };
  logger.info("Automatic leaderboard cleanup", {
    configCount: configs.count,
    configOutcome: configs.outcome,
    enrollmentCount: enrollments.count,
    enrollmentOutcome: enrollments.outcome,
    receiptCount: receipts.count,
    receiptOutcome: receipts.outcome,
  });
  return result;
};

// create main app
export function createApp({
  apiHandler = apiRouter,
  nativeAutomaticHandler = automaticLeaderboardNativeRouter,
  staticHandler = staticRouter,
  publicMiddleware,
  readiness = createReadinessController({ probe: () => Promise.resolve(true) }),
  webMiddleware,
}: {
  apiHandler?: express.RequestHandler;
  nativeAutomaticHandler?: express.RequestHandler;
  staticHandler?: express.RequestHandler;
  /** Dynamic policy documents that must precede Vite in development. */
  publicMiddleware?: express.RequestHandler;
  readiness?: ReadinessController;
  webMiddleware?: express.RequestHandler;
} = {}): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", "strong");
  // Production traffic reaches Express through the cloudflared sidecar on the
  // task loopback interface. Trust only that hop so rate limiting can use the
  // client address without accepting forwarded headers from direct callers.
  app.set("trust proxy", "loopback");
  app.use(createHttpTelemetryMiddleware());
  app.use(createHttpSecurityMiddleware());
  app.use(httpCachePolicy);
  app.use(createHealthRouter(readiness));
  // use SSL in production
  if (process.env.NODE_ENV === "production") {
    app.use((request, response, next) => {
      // delegate native transport rejection without redirecting
      if (
        request.path === "/api/leaderboards/native" ||
        request.path.startsWith("/api/leaderboards/native/")
      ) {
        next();
        return;
      }
      forceHttps(request, response, next);
    });
  }
  // The dedicated advertiser-report origin is a separate, minimal surface.
  // Gate it before API, development middleware, and the normal app.
  app.use(createAdReportRouter());
  // isolate native parsing and policy before ordinary api middleware
  app.use("/api/leaderboards/native", nativeAutomaticHandler);
  app.use("/api/ads", express.json({ limit: "2kb" }));
  app.use("/report-data", express.json({ limit: "4kb" }));
  app.use("/report-export", express.json({ limit: "4kb" }));
  app.use(express.json());
  // mount routes
  app.use("/api", apiHandler);
  // Body-parser failures occur before the API router can install its own
  // terminal handler. Keep those failures inside the same JSON trust boundary.
  app.use("/api", apiErrorHandler);
  // mount optional public policy documents
  if (publicMiddleware) {
    app.use(publicMiddleware);
  }
  // mount optional development middleware
  if (webMiddleware) {
    app.use(webMiddleware);
  }
  app.use("/", staticHandler);
  return app;
}

// Scheduled and startup work shares the owner-admin registry.  Besides making
// status truthful, this gives every process the same database lease as a
// manual action, so a deploy/startup cannot overlap an admin refresh.
const performOperationInBackground = async (
  operation: AdminOperationName
): Promise<void> => {
  const result = await runAdminOperation(operation);
  reportOperationTelemetry(result.operation, operation);
  if (!result.started) {
    logger.info(
      `Skipped ${operation}; ${result.operation.operation} is already running`
    );
  } else if (result.operation.status === "failed") {
    logger.error(`Scheduled operation failed: ${operation}`);
  }
};

const runOperationInBackground = (
  operation: AdminOperationName
): Promise<void> =>
  serverBackgroundRegistry.runTask(() =>
    performOperationInBackground(operation)
  );

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

export function scheduleAdExposureCleanup(): void {
  scheduleJob(
    { minute: 45, second: 0 },
    safeScheduledTask("expired ad exposure cleanup", () =>
      serverBackgroundRegistry.runTask(async () => {
        const { cleanupExpiredAdExposures } =
          await import("~/services/public/adTracking");
        for (let batch = 0; batch < 20; batch += 1) {
          const deleted = await cleanupExpiredAdExposures();
          if (deleted < 5_000) {
            break;
          }
        }
      })
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
  serverBackgroundRegistry.trackTimer(timeout);
}

// schedule dependency-safe automatic cleanup
export function scheduleAutomaticLeaderboardCleanup(): void {
  // run once after startup stabilization
  deferStartupMaintenance("automatic leaderboard cleanup", async () => {
    await runAutomaticLeaderboardCleanup();
  });
  // repeat daily outside the primary refresh window
  scheduleJob(
    { hour: 3, minute: 30, second: 0 },
    safeScheduledTask("automatic leaderboard cleanup", async () => {
      await serverBackgroundRegistry.runTask(runAutomaticLeaderboardCleanup);
    })
  );
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
  reportRuntimeLifecycleTelemetry("startup");
  const artifacts = await loadProductionSsrArtifacts(__dirname);
  const documentRuntime = await createSsrRuntime({ artifacts });
  const readiness = createReadinessController({
    probe: async () => await db.query("SELECT 1"),
  });
  const app = createApp({
    readiness,
    staticHandler: createStaticRouter(undefined, {
      browserDependencies: { documentRuntime },
    }),
  });
  await dbInit;
  initializeWsfSeed();
  scheduleAdExposureCleanup();
  scheduleAutomaticLeaderboardCleanup();
  readiness.markInitialized();
  const server = app.listen(process.env.PORT, () => {
    reportRuntimeLifecycleTelemetry("ready");
    logger.info(`Server started on port ${process.env.PORT ?? "default"}`);
  });
  attachProcessSignalHandlers(
    createServerLifecycle({
      background: serverBackgroundRegistry,
      closeDatabase: async () => await db.close(),
      exit: (code) => process.exit(code),
      readiness,
      restart: () => process.kill(process.pid, "SIGUSR2"),
      server,
      telemetry: reportRuntimeLifecycleTelemetry,
    })
  );
  // scheduler ownership guard
  if (shouldRunScheduler()) {
    startScheduler();
    return;
  }
  startWsfCacheRefreshJobs();
  logger.info("Scheduler-only WSF jobs disabled for this process");
}
