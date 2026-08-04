import logger from "heroku-logger";
import {
  calculateOperationLag,
  OBSERVABILITY_SCHEMA_VERSION,
  type OperationLagOutcome,
} from "shared/lib/observability";

import type {
  AdminOperationName,
  AdminOperationState,
} from "./admin/operations";
import { normalizeRelease } from "./httpTelemetry";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const OPERATION_CADENCE_MS: Record<AdminOperationName, number> = {
  "camera-line-detection-refresh": MINUTE_MS,
  "clear-wsf-memory-cache": DAY_MS,
  "demand-events-refresh": DAY_MS,
  "fare-catalog-refresh": HOUR_MS,
  "leaderboard-rebuild": 30 * DAY_MS,
  "schedule-refresh": DAY_MS,
  "tide-forecast-refresh": 5 * MINUTE_MS,
  "weather-forecast-refresh": 5 * MINUTE_MS,
  "wsf-daily-refresh": DAY_MS,
  "wsf-long-refresh": 5 * MINUTE_MS,
  "wsf-notifying-refresh": 5 * MINUTE_MS,
  "wsf-refresh": 5 * MINUTE_MS,
  "wsf-short-notifying-refresh": MINUTE_MS,
  "wsf-short-refresh": MINUTE_MS,
};

export interface OperationTelemetryEvent {
  cadenceMs: number;
  event: "scheduled_operation";
  lagMs: number | null;
  observedAt: string;
  operation: AdminOperationName;
  outcome: OperationLagOutcome;
  release: string;
  schemaVersion: typeof OBSERVABILITY_SCHEMA_VERSION;
}

export type RuntimeLifecycleStage =
  | "drain-completed"
  | "drain-forced"
  | "drain-started"
  | "ready"
  | "startup";

export interface RuntimeLifecycleTelemetryEvent {
  event: "server_lifecycle";
  release: string;
  schemaVersion: typeof OBSERVABILITY_SCHEMA_VERSION;
  stage: RuntimeLifecycleStage;
}

export const operationStateToTelemetry = (
  state: AdminOperationState,
  observedAt = new Date().toISOString(),
  operation = state.operation
): OperationTelemetryEvent => {
  const cadenceMs = OPERATION_CADENCE_MS[operation];
  const lag = calculateOperationLag(
    {
      cadenceMs,
      endedAt: state.endedAt,
      leaseExpiresAt: state.leaseExpiresAt,
      startedAt: state.startedAt,
      status: state.status,
    },
    observedAt
  );
  return {
    cadenceMs,
    event: "scheduled_operation",
    lagMs: lag.lagMs,
    observedAt,
    operation,
    outcome: lag.outcome,
    release: normalizeRelease(
      process.env.HEROKU_RELEASE_VERSION ?? process.env.SOURCE_VERSION
    ),
    schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
  };
};

export const reportOperationTelemetry = (
  state: AdminOperationState,
  operation = state.operation
): void => {
  logger.info(
    "Scheduled operation telemetry",
    operationStateToTelemetry(state, new Date().toISOString(), operation)
  );
};

export const reportRuntimeLifecycleTelemetry = (
  stage: RuntimeLifecycleStage
): void => {
  const event: RuntimeLifecycleTelemetryEvent = {
    event: "server_lifecycle",
    release: normalizeRelease(
      process.env.HEROKU_RELEASE_VERSION ?? process.env.SOURCE_VERSION
    ),
    schemaVersion: OBSERVABILITY_SCHEMA_VERSION,
    stage,
  };
  logger.info("Server lifecycle telemetry", event);
};
