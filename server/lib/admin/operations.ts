import { randomUUID } from "crypto";
import { Transaction } from "sequelize";

import { refreshCameraLineDetectionCache } from "~/lib/cameraLineDetection";
import { db } from "~/lib/db";
import { updateMajorSportsEvents } from "~/lib/demandEvents/updateMajorSportsEvents";
import { updateSchoolBreakEvents } from "~/lib/demandEvents/updateSchoolBreakEvents";
import { warmDueFareCatalogs, warmTodayFareCatalogs } from "~/lib/fareCache";
import { updateTideForecasts } from "~/lib/tides/updateForecasts";
import { updateWeatherForecasts } from "~/lib/weather/updateForecasts";
import {
  updateDaily,
  updateLong,
  updateScheduleCache,
  updateShort,
  updateUserFacingStatus,
} from "~/lib/wsf";
import { AdminOperationStatus } from "~/models/AdminOperationStatus";
import { Schedule } from "~/models/Schedule";

export const ADMIN_OPERATION_LEASE_MS = 15 * 60 * 1000;
export const ADMIN_OPERATION_LEASE_RENEWAL_MS = ADMIN_OPERATION_LEASE_MS / 2;

export type AdminOperationName =
  | "camera-line-detection-refresh"
  | "clear-wsf-memory-cache"
  | "demand-events-refresh"
  | "fare-catalog-refresh"
  | "leaderboard-rebuild"
  | "schedule-refresh"
  | "tide-forecast-refresh"
  | "weather-forecast-refresh"
  | "wsf-daily-refresh"
  | "wsf-long-refresh"
  | "wsf-refresh"
  | "wsf-short-notifying-refresh"
  | "wsf-short-refresh"
  | "wsf-notifying-refresh";

export type AdminOperationState = {
  canRun: boolean;
  description: string;
  endedAt: string | null;
  error: string | null;
  leaseExpiresAt: string | null;
  lastRunAt: string | null;
  operation: AdminOperationName;
  result: string | null;
  startedAt: string | null;
  status: "idle" | "running" | "succeeded" | "failed";
  trigger: string;
};

export type AdminOperationRunResult =
  | { operation: AdminOperationState; started: false }
  | { operation: AdminOperationState; started: true };

type OperationDefinition = {
  adminAllowed: boolean;
  description: string;
  destructive: boolean;
  run: () => Promise<void> | void;
  trigger: string;
};

/** Only these named functions can be started by an administrator. */
const operationRegistry: Record<AdminOperationName, OperationDefinition> = {
  "camera-line-detection-refresh": {
    adminAllowed: true,
    description:
      "Refreshes camera line-detection results used by camera views.",
    destructive: false,
    run: refreshCameraLineDetectionCache,
    trigger:
      "Every minute at :30 on the web process; also warmed after server startup.",
  },
  "clear-wsf-memory-cache": {
    adminAllowed: true,
    description:
      "Clears the rebuildable in-memory WSF schedule cache. Core route, terminal, vessel, and camera catalogs stay available.",
    destructive: true,
    run: () => {
      // The route catalog is part of the immediately available baseline.
      // Clearing it can leave every terminal without mates while an upstream
      // refresh is delayed or unavailable.
      Schedule.purge();
    },
    trigger: "Daily at 04:00 server time.",
  },
  "demand-events-refresh": {
    adminAllowed: true,
    description:
      "Refreshes major sports and school-break demand-event inputs for forecasts.",
    destructive: false,
    run: async () => {
      await Promise.all([updateMajorSportsEvents(), updateSchoolBreakEvents()]);
    },
    trigger:
      "Daily at 04:20 server time; also deferred after scheduler startup.",
  },
  "leaderboard-rebuild": {
    adminAllowed: true,
    description:
      "Rebuilds leaderboard aggregates from retained check-in records.",
    destructive: false,
    run: async () => {
      const { rebuildLeaderboardAggregates } =
        await import("~/lib/admin/leaderboardModeration");
      await rebuildLeaderboardAggregates();
    },
    trigger: "Manual only.",
  },
  "fare-catalog-refresh": {
    adminAllowed: true,
    description:
      "Warms current ferry-day fare catalogs and due fare cache entries.",
    destructive: false,
    run: async () => {
      await warmTodayFareCatalogs();
      await warmDueFareCatalogs();
    },
    trigger:
      "Hourly at :15, daily at 00:05 America/Los_Angeles, and deferred after startup.",
  },
  "schedule-refresh": {
    adminAllowed: true,
    description: "Refreshes WSF sailing schedules and schedule cache data.",
    destructive: false,
    run: updateScheduleCache,
    trigger: "Daily at 04:05 server time.",
  },
  "tide-forecast-refresh": {
    adminAllowed: true,
    description:
      "Forces a refresh of tide forecast inputs used by route forecasting.",
    destructive: false,
    run: async () => {
      await updateTideForecasts({ force: true });
    },
    trigger:
      "Best-effort after short WSF refreshes, subject to the environment refresh rate limit.",
  },
  "weather-forecast-refresh": {
    adminAllowed: true,
    description:
      "Forces a refresh of weather forecast inputs used by route forecasting.",
    destructive: false,
    run: async () => {
      await updateWeatherForecasts({ force: true });
    },
    trigger:
      "Best-effort after short WSF refreshes, subject to the environment refresh rate limit.",
  },
  "wsf-daily-refresh": {
    adminAllowed: true,
    description: "Runs daily WSF route-to-vessel inference.",
    destructive: false,
    run: updateDaily,
    trigger: "Daily at 04:10 server time.",
  },
  "wsf-long-refresh": {
    adminAllowed: true,
    description: "Refreshes WSF cameras, vessels, routes, and terminals.",
    destructive: false,
    run: updateLong,
    trigger: "Every 5 minutes.",
  },
  "wsf-refresh": {
    adminAllowed: true,
    description:
      "Runs a full WSF refresh: long data, user-facing status, and schedules without sending notifications.",
    destructive: false,
    run: async () => {
      await updateLong();
      // Deliberately the no-notification path for manual admin refreshes.
      await updateUserFacingStatus();
      await updateScheduleCache();
    },
    trigger:
      "At non-notifying fallback startup and when run manually; shares one lease with all WSF refreshes.",
  },
  "wsf-short-notifying-refresh": {
    adminAllowed: false,
    description:
      "Refreshes WSF vessel status and capacity and sends eligible notifications.",
    destructive: false,
    run: updateShort,
    trigger: "Every minute on the web process.",
  },
  "wsf-short-refresh": {
    adminAllowed: true,
    description:
      "Refreshes WSF vessel status and capacity without sending notifications.",
    destructive: false,
    run: updateUserFacingStatus,
    trigger:
      "Every minute in non-notifying fallback mode; shares one lease with all WSF refreshes.",
  },
  "wsf-notifying-refresh": {
    adminAllowed: false,
    description:
      "Runs full WSF cache warming with notification-capable short refreshes.",
    destructive: false,
    run: async () => {
      await updateLong();
      await updateShort();
      await updateScheduleCache();
    },
    trigger: "At web server startup.",
  },
};

const allNames = Object.keys(operationRegistry) as AdminOperationName[];
const names = allNames.filter(
  (operation) => operationRegistry[operation].adminAllowed
);

// The WSF refreshes update the same cache and upstream-derived records, even
// when they are scheduled as separate fast, slow, or daily jobs.  They must
// therefore contend for one lease with the composite manual refresh rather
// than only with another invocation of their exact job name.
const WSF_LEASE_OPERATIONS = new Set<AdminOperationName>([
  "schedule-refresh",
  "wsf-daily-refresh",
  "wsf-long-refresh",
  "wsf-notifying-refresh",
  "wsf-refresh",
  "wsf-short-notifying-refresh",
  "wsf-short-refresh",
]);

const leaseOperationFor = (
  operation: AdminOperationName
): AdminOperationName =>
  WSF_LEASE_OPERATIONS.has(operation) ? "wsf-refresh" : operation;

export const isAdminOperationName = (
  value: string
): value is AdminOperationName => names.includes(value as AdminOperationName);

export const isDestructiveAdminOperation = (
  operation: AdminOperationName
): boolean => operationRegistry[operation].destructive;

const toState = (
  operation: AdminOperationName,
  row?: AdminOperationStatus
): AdminOperationState => ({
  canRun: operationRegistry[operation].adminAllowed,
  description: operationRegistry[operation].description,
  endedAt: row?.endedAt?.toISOString() ?? null,
  error: row?.error ?? null,
  leaseExpiresAt: row?.leaseExpiresAt?.toISOString() ?? null,
  lastRunAt: (row?.endedAt ?? row?.startedAt)?.toISOString() ?? null,
  operation,
  result: row?.result ?? null,
  startedAt: row?.startedAt?.toISOString() ?? null,
  status: row?.status ?? "idle",
  trigger: operationRegistry[operation].trigger,
});

const getLockedRow = async (
  operation: AdminOperationName,
  transaction: Transaction
): Promise<AdminOperationStatus> => {
  // findOrCreate handles the first-use insertion race, then this explicit lock
  // serializes all later owners using SELECT ... FOR UPDATE.
  await AdminOperationStatus.findOrCreate({
    defaults: { operation, status: "idle" },
    transaction,
    where: { operation },
  });
  const row = await AdminOperationStatus.findOne({
    lock: transaction.LOCK.UPDATE,
    transaction,
    where: { operation },
  });
  if (!row) {
    throw new Error("Admin operation status row was not created");
  }
  return row;
};

const acquireOperationLease = (
  operation: AdminOperationName,
  now: Date
): Promise<{ state: AdminOperationState; token?: string }> =>
  db.transaction(async (transaction) => {
    const row = await getLockedRow(operation, transaction);
    if (
      row.status === "running" &&
      row.leaseExpiresAt !== null &&
      row.leaseExpiresAt.getTime() > now.getTime()
    ) {
      return { state: toState(operation, row) };
    }

    const token = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + ADMIN_OPERATION_LEASE_MS);
    await row.update(
      {
        endedAt: null,
        error: null,
        leaseExpiresAt,
        leaseToken: token,
        result: null,
        startedAt: now,
        status: "running",
      },
      { transaction }
    );
    return { state: toState(operation, row), token };
  });

/**
 * Extends a running lease only when this process still owns its token. A zero
 * update means another process has recovered or replaced the lease, so the
 * caller must never write a terminal state for that newer owner.
 */
const renewOperationLease = async (
  operation: AdminOperationName,
  token: string,
  now = new Date()
): Promise<boolean> => {
  const [updated] = await AdminOperationStatus.update(
    { leaseExpiresAt: new Date(now.getTime() + ADMIN_OPERATION_LEASE_MS) },
    { where: { leaseToken: token, operation, status: "running" } }
  );
  return updated === 1;
};

const finishOperation = async (
  operation: AdminOperationName,
  token: string,
  outcome: Pick<AdminOperationStatus, "error" | "result" | "status">,
  now: Date
): Promise<AdminOperationState> => {
  // Token matching means an expired worker cannot overwrite a newer lease.
  await AdminOperationStatus.update(
    {
      endedAt: now,
      error: outcome.error,
      leaseExpiresAt: null,
      leaseToken: null,
      result: outcome.result,
      status: outcome.status,
    },
    { where: { leaseToken: token, operation, status: "running" } }
  );
  const row = await AdminOperationStatus.findByPk(operation);
  if (!row) {
    throw new Error("Admin operation status row disappeared");
  }
  return toState(operation, row);
};

export const getAdminOperationStates = (): Promise<AdminOperationState[]> =>
  Promise.all(
    allNames.map(async (operation) => {
      // WSF work intentionally shares one lease row so concurrent scheduled,
      // startup, and manual refreshes cannot overlap. Use that same row for
      // its displayed latest activity rather than showing "Never recorded"
      // on every logical WSF job except the composite refresh.
      const row = await AdminOperationStatus.findByPk(
        leaseOperationFor(operation)
      );
      return toState(operation, row ?? undefined);
    })
  );

/**
 * Starts one registry operation if no non-expired lease owns it. A stale lease
 * is recovered by overwriting this one status row; no operation history exists.
 */
export const runAdminOperation = async (
  operation: AdminOperationName,
  now = new Date()
): Promise<AdminOperationRunResult> => {
  const leaseOperation = leaseOperationFor(operation);
  const lease = await acquireOperationLease(leaseOperation, now);
  if (!lease.token) {
    return { operation: lease.state, started: false };
  }
  const leaseToken = lease.token;

  let leaseOwnershipLost = false;
  let renewal: Promise<void> | undefined;
  const renewLease = (): void => {
    if (leaseOwnershipLost || renewal) {
      return;
    }
    renewal = renewOperationLease(leaseOperation, leaseToken)
      .then((renewed) => {
        // The operation cannot be safely cancelled, but a former owner must
        // stop renewing and rely on token-conditional terminal updates.
        leaseOwnershipLost = !renewed;
      })
      .catch(() => {
        // Treat an unavailable lease store as lost ownership instead of
        // extending an unverified lease in memory.
        leaseOwnershipLost = true;
      })
      .finally(() => {
        renewal = undefined;
      });
  };
  const heartbeat = setInterval(renewLease, ADMIN_OPERATION_LEASE_RENEWAL_MS);

  let outcome: Pick<AdminOperationStatus, "error" | "result" | "status">;
  try {
    await operationRegistry[operation].run();
    outcome = { error: null, result: "Completed", status: "succeeded" };
  } catch {
    outcome = { error: "Operation failed", result: null, status: "failed" };
  } finally {
    // Prevent a renewal from racing the token-conditional terminal update.
    clearInterval(heartbeat);
    await renewal;
  }

  return {
    // A lost lease is safe here: finishOperation's token condition leaves a
    // replacement owner's row untouched and returns its current state.
    operation: await finishOperation(
      leaseOperation,
      leaseToken,
      outcome,
      new Date()
    ),
    started: true,
  };
};
