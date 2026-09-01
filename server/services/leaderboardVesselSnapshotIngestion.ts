import { AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS } from "shared/contracts/leaderboards";

import { db } from "~/lib/db";
import logger from "~/lib/logger";
import { wsfDateToTimestamp } from "~/lib/wsf/date";
import { Vessel } from "~/models/Vessel";
import { WSF } from "~/typings/wsf";

import { stableSailingId } from "../lib/leaderboards";

const MINUTE_MS = 60 * 1000;
const WSF_DATE_MILLISECONDS = /^\/Date\((\d+)[+-]\d{4}\)\/$/;

export const LEADERBOARD_VESSEL_FUTURE_CEILING_MS = 5 * MINUTE_MS;
export const LEADERBOARD_VESSEL_SOURCE_CEILING_MS = 5 * MINUTE_MS;
export const LEADERBOARD_VESSEL_GAP_CEILING_MS = 10 * MINUTE_MS;
export const LEADERBOARD_VESSEL_PROCESSING_CEILING_MS = 5 * MINUTE_MS;
export const LEADERBOARD_VESSEL_MAX_ROWS = 2_000_000;

/** conservative pre-freeze retention inputs */
export interface LeaderboardVesselSnapshotPolicy {
  candidateRetentionMs: number;
  futureCeilingMs: number;
  gapCeilingMs: number;
  processingCeilingMs: number;
  sourceCeilingMs: number;
}

type SnapshotPolicy = LeaderboardVesselSnapshotPolicy;

export const DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY: SnapshotPolicy =
  Object.freeze({
    candidateRetentionMs: AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
    futureCeilingMs: LEADERBOARD_VESSEL_FUTURE_CEILING_MS,
    gapCeilingMs: LEADERBOARD_VESSEL_GAP_CEILING_MS,
    processingCeilingMs: LEADERBOARD_VESSEL_PROCESSING_CEILING_MS,
    sourceCeilingMs: LEADERBOARD_VESSEL_SOURCE_CEILING_MS,
  });

/** fixed aggregate ingest outcomes */
export type LeaderboardVesselSnapshotIngestOutcome =
  | "invalid_coordinates"
  | "invalid_motion"
  | "invalid_source_time"
  | "migration_missing"
  | "missing_vessel"
  | "older_source_ignored"
  | "skipped_refresh"
  | "stored"
  | "unstable_sailing"
  | "write_failed";

/** fixed aggregate batch status */
export type LeaderboardVesselSnapshotBatchOutcome =
  | "complete"
  | "degraded"
  | "migration_missing"
  | "skipped";

/** retained S1 row without private location history */
export interface LeaderboardVesselSnapshotRow {
  arrivingTerminalId: number | null;
  departedAtSeconds: number | null;
  departingTerminalId: number;
  headingDegrees: number;
  inMaintenance: boolean;
  inService: boolean;
  isAtDock: boolean;
  latitude: number;
  longitude: number;
  minuteBucketStartMs: number;
  receivedAtMs: number;
  retainUntilMs: number;
  sailingId: string | null;
  sourceObservedAtMs: number;
  speedKnots: number;
  vesselId: string;
}

/** per-sailing durable coverage */
export interface LeaderboardVesselSailingCoverage {
  maxGapMs: number;
  rowCount: number;
  sailingId: string;
}

/** aggregate durable coverage */
export interface LeaderboardVesselSnapshotCoverage {
  earliestSourceObservedAtMs: number | null;
  latestSourceObservedAtMs: number | null;
  maxGapMs: number | null;
  maxSourceLagMs: number | null;
  sailings: LeaderboardVesselSailingCoverage[];
  totalRows: number;
}

/** injectable durable store */
export interface LeaderboardVesselSnapshotPersistence {
  isDeployed: () => Promise<boolean>;
  prune: (nowMs: number) => Promise<number>;
  readCoverage: () => Promise<LeaderboardVesselSnapshotCoverage>;
  upsertNewest: (
    row: LeaderboardVesselSnapshotRow
  ) => Promise<"older_source_ignored" | "stored">;
}

type SnapshotPersistence = LeaderboardVesselSnapshotPersistence;

/** fixed aggregate ingest counts */
export type LeaderboardVesselSnapshotIngestCounts = Record<
  LeaderboardVesselSnapshotIngestOutcome,
  number
>;

/** aggregate ingest evidence */
export interface LeaderboardVesselSnapshotBatchHealth {
  counts: LeaderboardVesselSnapshotIngestCounts;
  ingestHealthy: boolean;
  outcome: LeaderboardVesselSnapshotBatchOutcome;
  receivedAtMs: number;
  vesselDetectorEnabled: false;
}

/** fixed runtime health */
export interface LeaderboardVesselSnapshotRuntimeHealth {
  ingestHealthy: boolean;
  lastIngestOutcome: LeaderboardVesselSnapshotBatchOutcome | "not_observed";
  lastPruneOutcome: "not_observed" | "prune_failed" | "pruned";
  pruneHealthy: boolean;
  vesselDetectorEnabled: false;
}

/** fixed readiness reasons */
export type LeaderboardVesselHistoryReadinessReason =
  | "capacity_unhealthy"
  | "history_short"
  | "ingest_unhealthy"
  | "invalid_policy"
  | "migration_missing"
  | "missing_sailing"
  | "prune_unhealthy"
  | "ready"
  | "source_gap"
  | "source_lag";

/** aggregate S1 readiness */
export interface LeaderboardVesselHistoryReadiness {
  capacityHealthy: boolean;
  coverageDurationMs: number;
  gapHealthy: boolean;
  ingestHealthy: boolean;
  missingRequiredSailingCount: number;
  pruneHealthy: boolean;
  reason: LeaderboardVesselHistoryReadinessReason;
  retentionMs: number;
  sourceHealthy: boolean;
  vesselDetectorEnabled: false;
  vesselHistoryReady: boolean;
}

interface IngestOptions {
  persistence?: LeaderboardVesselSnapshotPersistence;
  policy?: LeaderboardVesselSnapshotPolicy;
  receivedAtMs?: number;
}

interface PruneOptions {
  nowMs?: number;
  persistence?: LeaderboardVesselSnapshotPersistence;
  policy?: LeaderboardVesselSnapshotPolicy;
}

interface ReadinessOptions extends PruneOptions {
  maxRows?: number;
  requiredSailingIds: string[];
}

interface DatabaseError {
  original?: { code?: string };
  parent?: { code?: string };
}

const minimumPolicy = DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY;

let runtimeHealth: LeaderboardVesselSnapshotRuntimeHealth = {
  ingestHealthy: false,
  lastIngestOutcome: "not_observed",
  lastPruneOutcome: "not_observed",
  pruneHealthy: false,
  vesselDetectorEnabled: false,
};

// parse bigint aggregate values safely
const safeAggregateNumber = (value: unknown): number | null => {
  // preserve nullable aggregates
  if (value === null || value === undefined) {
    return null;
  }
  // normalize numeric aggregates
  const number = typeof value === "number" ? value : Number(value);
  // reject lossy database values
  if (!Number.isSafeInteger(number)) {
    throw new Error("invalid_snapshot_aggregate");
  }
  return number;
};

// require safe non-negative durations
const requireDuration = (value: number): number => {
  // reject unsafe policy values
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("invalid_snapshot_policy");
  }
  return value;
};

// validate a conservative policy
const validatePolicy = (
  policy: LeaderboardVesselSnapshotPolicy
): LeaderboardVesselSnapshotPolicy => {
  const validated = {
    candidateRetentionMs: requireDuration(policy.candidateRetentionMs),
    futureCeilingMs: requireDuration(policy.futureCeilingMs),
    gapCeilingMs: requireDuration(policy.gapCeilingMs),
    processingCeilingMs: requireDuration(policy.processingCeilingMs),
    sourceCeilingMs: requireDuration(policy.sourceCeilingMs),
  };
  // prohibit pre-freeze reductions
  if (
    validated.candidateRetentionMs < minimumPolicy.candidateRetentionMs ||
    validated.futureCeilingMs < minimumPolicy.futureCeilingMs ||
    validated.gapCeilingMs < minimumPolicy.gapCeilingMs ||
    validated.processingCeilingMs < minimumPolicy.processingCeilingMs ||
    validated.sourceCeilingMs < minimumPolicy.sourceCeilingMs
  ) {
    throw new Error("invalid_snapshot_policy");
  }
  return validated;
};

/** compute the exact conservative retention window */
export const leaderboardVesselSnapshotRetentionMs = (
  policy = DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY
): number => {
  const validated = validatePolicy(policy);
  const retentionMs =
    validated.candidateRetentionMs +
    validated.futureCeilingMs +
    validated.sourceCeilingMs +
    validated.gapCeilingMs +
    validated.processingCeilingMs;
  // reject duration overflow
  if (!Number.isSafeInteger(retentionMs)) {
    throw new Error("invalid_snapshot_policy");
  }
  return retentionMs;
};

export const LEADERBOARD_VESSEL_SNAPSHOT_PRE_FREEZE_RETENTION_MS =
  leaderboardVesselSnapshotRetentionMs();

/** retain a gap margin on both warm-window edges */
export const leaderboardVesselSnapshotStorageRetentionMs = (
  policy = DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY
): number => {
  const validated = validatePolicy(policy);
  const storageRetentionMs =
    leaderboardVesselSnapshotRetentionMs(validated) +
    2 * validated.gapCeilingMs;
  // reject margin overflow
  if (!Number.isSafeInteger(storageRetentionMs)) {
    throw new Error("invalid_snapshot_policy");
  }
  return storageRetentionMs;
};

export const LEADERBOARD_VESSEL_SNAPSHOT_STORAGE_RETENTION_MS =
  leaderboardVesselSnapshotStorageRetentionMs();

// create fixed count keys
const emptyIngestCounts = (): LeaderboardVesselSnapshotIngestCounts => ({
  invalid_coordinates: 0,
  invalid_motion: 0,
  invalid_source_time: 0,
  migration_missing: 0,
  missing_vessel: 0,
  older_source_ignored: 0,
  skipped_refresh: 0,
  stored: 0,
  unstable_sailing: 0,
  write_failed: 0,
});

// recognize an absent migrated table
const isMissingMigrationError = (error: unknown): boolean => {
  const databaseError = error as DatabaseError;
  return (
    databaseError?.original?.code === "42P01" ||
    databaseError?.parent?.code === "42P01"
  );
};

// read normal query rows
const queryRows = (result: unknown): Record<string, unknown>[] => {
  // normalize sequelize tuple results
  if (!Array.isArray(result) || !Array.isArray(result[0])) {
    return [];
  }
  return result[0] as Record<string, unknown>[];
};

// preserve exact WSF source milliseconds
const wsfSourceObservedAtMs = (value: unknown): number | null => {
  // reject non-string external timestamps
  if (typeof value !== "string") {
    return null;
  }
  const match = value.match(WSF_DATE_MILLISECONDS);
  // reject malformed external timestamps
  if (!match?.[1]) {
    return null;
  }
  const milliseconds = Number(match[1]);
  // reject unsafe external timestamps
  if (!Number.isSafeInteger(milliseconds) || milliseconds <= 0) {
    return null;
  }
  return milliseconds;
};

/** production Postgres persistence */
export const leaderboardVesselSnapshotPostgresPersistence: SnapshotPersistence =
  {
    // verify migration deployment
    async isDeployed(): Promise<boolean> {
      const result = await db.query(
        `SELECT to_regclass('"LeaderboardVesselVerificationSnapshots"') AS "tableName"`
      );
      return typeof queryRows(result)[0]?.tableName === "string";
    },

    // prune only elapsed retained rows
    async prune(nowMs: number): Promise<number> {
      const [, metadata] = await db.query(
        `
        DELETE FROM "LeaderboardVesselVerificationSnapshots"
        WHERE "retainUntilMs" <= :nowMs
        `,
        { replacements: { nowMs } }
      );
      const rowCount = (metadata as { rowCount?: number })?.rowCount;
      // normalize affected rows
      return Number.isSafeInteger(rowCount) ? (rowCount as number) : 0;
    },

    // read only aggregate coverage
    async readCoverage(): Promise<LeaderboardVesselSnapshotCoverage> {
      const globalResult = await db.query(`
        WITH source_times AS (
          SELECT DISTINCT "sourceObservedAtMs"
          FROM "LeaderboardVesselVerificationSnapshots"
        ), ordered_source_times AS (
          SELECT
            "sourceObservedAtMs",
            lag("sourceObservedAtMs") OVER (ORDER BY "sourceObservedAtMs") AS previous_source_ms
          FROM source_times
        ), global_gaps AS (
          SELECT max("sourceObservedAtMs" - previous_source_ms) AS max_gap_ms
          FROM ordered_source_times
        )
        SELECT
          min(s."sourceObservedAtMs") AS earliest_source_ms,
          max(s."sourceObservedAtMs") AS latest_source_ms,
          max(s."receivedAtMs" - s."sourceObservedAtMs") AS max_source_lag_ms,
          count(*) AS total_rows,
          (SELECT max_gap_ms FROM global_gaps) AS max_gap_ms
        FROM "LeaderboardVesselVerificationSnapshots" s
      `);
      const sailingResult = await db.query(`
        WITH ordered AS (
          SELECT
            "sailingId",
            "sourceObservedAtMs",
            lag("sourceObservedAtMs") OVER (
              PARTITION BY "sailingId"
              ORDER BY "sourceObservedAtMs"
            ) AS previous_source_ms
          FROM "LeaderboardVesselVerificationSnapshots"
          WHERE "sailingId" IS NOT NULL
        )
        SELECT
          "sailingId" AS sailing_id,
          count(*) AS row_count,
          coalesce(max("sourceObservedAtMs" - previous_source_ms), 0) AS max_gap_ms
        FROM ordered
        GROUP BY "sailingId"
      `);
      const global = queryRows(globalResult)[0] ?? {};
      return {
        earliestSourceObservedAtMs: safeAggregateNumber(
          global.earliest_source_ms
        ),
        latestSourceObservedAtMs: safeAggregateNumber(global.latest_source_ms),
        maxGapMs: safeAggregateNumber(global.max_gap_ms),
        maxSourceLagMs: safeAggregateNumber(global.max_source_lag_ms),
        // normalize per-sailing aggregates
        sailings: queryRows(sailingResult).map((row) => ({
          maxGapMs: safeAggregateNumber(row.max_gap_ms) ?? 0,
          rowCount: safeAggregateNumber(row.row_count) ?? 0,
          sailingId: String(row.sailing_id),
        })),
        totalRows: safeAggregateNumber(global.total_rows) ?? 0,
      };
    },

    // keep only the newest source observation per vessel minute
    async upsertNewest(
      row: LeaderboardVesselSnapshotRow
    ): Promise<"older_source_ignored" | "stored"> {
      const result = await db.query(
        `
        INSERT INTO "LeaderboardVesselVerificationSnapshots" (
          "vesselId",
          "sailingId",
          "minuteBucketStartMs",
          "sourceObservedAtMs",
          "receivedAtMs",
          "retainUntilMs",
          "latitude",
          "longitude",
          "isAtDock",
          "inService",
          "inMaintenance",
          "departingTerminalId",
          "arrivingTerminalId",
          "departedAtSeconds",
          "speedKnots",
          "headingDegrees"
        ) VALUES (
          :vesselId,
          :sailingId,
          :minuteBucketStartMs,
          :sourceObservedAtMs,
          :receivedAtMs,
          :retainUntilMs,
          :latitude,
          :longitude,
          :isAtDock,
          :inService,
          :inMaintenance,
          :departingTerminalId,
          :arrivingTerminalId,
          :departedAtSeconds,
          :speedKnots,
          :headingDegrees
        )
        ON CONFLICT ("vesselId", "minuteBucketStartMs") DO UPDATE SET
          "sailingId" = EXCLUDED."sailingId",
          "sourceObservedAtMs" = EXCLUDED."sourceObservedAtMs",
          "receivedAtMs" = EXCLUDED."receivedAtMs",
          "retainUntilMs" = greatest(
            "LeaderboardVesselVerificationSnapshots"."retainUntilMs",
            EXCLUDED."retainUntilMs"
          ),
          "latitude" = EXCLUDED."latitude",
          "longitude" = EXCLUDED."longitude",
          "isAtDock" = EXCLUDED."isAtDock",
          "inService" = EXCLUDED."inService",
          "inMaintenance" = EXCLUDED."inMaintenance",
          "departingTerminalId" = EXCLUDED."departingTerminalId",
          "arrivingTerminalId" = EXCLUDED."arrivingTerminalId",
          "departedAtSeconds" = EXCLUDED."departedAtSeconds",
          "speedKnots" = EXCLUDED."speedKnots",
          "headingDegrees" = EXCLUDED."headingDegrees"
        WHERE EXCLUDED."sourceObservedAtMs" >
          "LeaderboardVesselVerificationSnapshots"."sourceObservedAtMs"
        RETURNING "id"
        `,
        { replacements: { ...row } }
      );
      // classify conditional no-ops
      return queryRows(result).length > 0 ? "stored" : "older_source_ignored";
    },
  };

// convert one WSF observation into a validated row
const buildSnapshotRow = (
  location: WSF.VesselsLocationResponse,
  receivedAtMs: number,
  policy: LeaderboardVesselSnapshotPolicy
): LeaderboardVesselSnapshotRow | LeaderboardVesselSnapshotIngestOutcome => {
  const sourceObservedAtMs = wsfSourceObservedAtMs(location.TimeStamp);
  // reject malformed source or receive clocks
  if (
    !Number.isSafeInteger(receivedAtMs) ||
    receivedAtMs <= 0 ||
    sourceObservedAtMs === null ||
    sourceObservedAtMs > receivedAtMs + policy.futureCeilingMs
  ) {
    return "invalid_source_time";
  }
  // reject malformed public positions
  if (
    !Number.isFinite(location.Latitude) ||
    !Number.isFinite(location.Longitude) ||
    location.Latitude < -90 ||
    location.Latitude > 90 ||
    location.Longitude < -180 ||
    location.Longitude > 180
  ) {
    return "invalid_coordinates";
  }
  // reject malformed public motion
  if (
    !Number.isFinite(location.Speed) ||
    !Number.isFinite(location.Heading) ||
    location.Speed < 0 ||
    location.Speed > 100 ||
    location.Heading < 0 ||
    location.Heading > 360
  ) {
    return "invalid_motion";
  }
  // require exact public state types
  if (
    typeof location.AtDock !== "boolean" ||
    typeof location.InService !== "boolean" ||
    !Number.isInteger(location.VesselID) ||
    location.VesselID <= 0
  ) {
    return "unstable_sailing";
  }
  const vessel = Vessel.getByIndex(String(location.VesselID));
  // require hydrated maintenance metadata
  if (!vessel) {
    return "missing_vessel";
  }
  const departingTerminalId = location.DepartingTerminalID;
  // normalize absent destination
  const arrivingTerminalId = location.ArrivingTerminalID ?? null;
  // require valid public route identifiers
  if (
    !Number.isInteger(departingTerminalId) ||
    departingTerminalId <= 0 ||
    (arrivingTerminalId !== null &&
      (!Number.isInteger(arrivingTerminalId) || arrivingTerminalId <= 0))
  ) {
    return "unstable_sailing";
  }
  const departedAtSeconds = wsfDateToTimestamp(location.LeftDock);
  const underway = location.InService && !location.AtDock;
  // derive only underway identity
  const sailingId = underway
    ? stableSailingId(
        {
          arrivingTerminalId: arrivingTerminalId ?? undefined,
          departedTime: departedAtSeconds,
          departingTerminalId,
          id: String(location.VesselID),
          inService: true,
          isAtDock: false,
          location: {
            latitude: location.Latitude,
            longitude: location.Longitude,
          },
          statusUpdatedAt: receivedAtMs,
        },
        receivedAtMs
      )
    : null;
  // require stable identity for underway service
  if (underway && !sailingId) {
    return "unstable_sailing";
  }
  const minuteBucketStartMs =
    Math.floor(sourceObservedAtMs / MINUTE_MS) * MINUTE_MS;
  const retentionMs = leaderboardVesselSnapshotStorageRetentionMs(policy);
  const retainUntilMs = sourceObservedAtMs + retentionMs;
  // reject timestamp arithmetic overflow
  if (!Number.isSafeInteger(retainUntilMs)) {
    return "invalid_source_time";
  }
  return {
    arrivingTerminalId,
    // preserve absent departure
    departedAtSeconds: departedAtSeconds > 0 ? departedAtSeconds : null,
    departingTerminalId,
    headingDegrees: location.Heading,
    inMaintenance: Boolean(vessel.inMaintenance),
    inService: location.InService,
    isAtDock: location.AtDock,
    latitude: location.Latitude,
    longitude: location.Longitude,
    minuteBucketStartMs,
    receivedAtMs,
    retainUntilMs,
    sailingId,
    sourceObservedAtMs,
    speedKnots: location.Speed,
    vesselId: String(location.VesselID),
  };
};

// emit aggregate health without entity data
const reportBatchHealth = (
  health: LeaderboardVesselSnapshotBatchHealth
): void => {
  logger.info("Leaderboard vessel snapshot ingest", health);
};

/** record a skipped WSF refresh without manufacturing observations */
export const recordSkippedLeaderboardVesselStatusRefresh = (
  receivedAtMs = Date.now()
): LeaderboardVesselSnapshotBatchHealth => {
  const counts = emptyIngestCounts();
  counts.skipped_refresh = 1;
  const health: LeaderboardVesselSnapshotBatchHealth = {
    counts,
    ingestHealthy: false,
    outcome: "skipped",
    receivedAtMs,
    vesselDetectorEnabled: false,
  };
  runtimeHealth = {
    ...runtimeHealth,
    ingestHealthy: false,
    lastIngestOutcome: "skipped",
  };
  reportBatchHealth(health);
  return health;
};

/** ingest one complete WSF vessel-status response */
export const ingestLeaderboardVesselStatusRefresh = async (
  locations: WSF.VesselsLocationResponse[],
  options: IngestOptions = {}
): Promise<LeaderboardVesselSnapshotBatchHealth> => {
  // anchor one server receive time
  const receivedAtMs = options.receivedAtMs ?? Date.now();
  // select the durable store
  const persistence =
    options.persistence ?? leaderboardVesselSnapshotPostgresPersistence;
  const counts = emptyIngestCounts();
  let policy: LeaderboardVesselSnapshotPolicy;
  // fail fixed on invalid policy
  try {
    policy = validatePolicy(
      options.policy ?? DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY
    );
  } catch {
    counts.invalid_source_time = locations.length || 1;
    const health: LeaderboardVesselSnapshotBatchHealth = {
      counts,
      ingestHealthy: false,
      outcome: "degraded",
      receivedAtMs,
      vesselDetectorEnabled: false,
    };
    runtimeHealth = {
      ...runtimeHealth,
      ingestHealthy: false,
      lastIngestOutcome: "degraded",
    };
    reportBatchHealth(health);
    return health;
  }
  // treat an empty source as a skipped refresh
  if (locations.length === 0) {
    return recordSkippedLeaderboardVesselStatusRefresh(receivedAtMs);
  }
  let deployed = false;
  // classify deployment failures without details
  try {
    deployed = await persistence.isDeployed();
  } catch {
    deployed = false;
  }
  // block ingestion before migration deployment
  if (!deployed) {
    counts.migration_missing = locations.length;
    const health: LeaderboardVesselSnapshotBatchHealth = {
      counts,
      ingestHealthy: false,
      outcome: "migration_missing",
      receivedAtMs,
      vesselDetectorEnabled: false,
    };
    runtimeHealth = {
      ...runtimeHealth,
      ingestHealthy: false,
      lastIngestOutcome: "migration_missing",
    };
    reportBatchHealth(health);
    return health;
  }
  // validate and persist each public observation
  for (const location of locations) {
    const row = buildSnapshotRow(location, receivedAtMs, policy);
    // count fixed validation outcomes
    if (typeof row === "string") {
      counts[row] += 1;
      continue;
    }
    // isolate individual persistence failures
    try {
      const outcome = await persistence.upsertNewest(row);
      counts[outcome] += 1;
    } catch (error) {
      // classify missing schema
      counts[
        isMissingMigrationError(error) ? "migration_missing" : "write_failed"
      ] += 1;
    }
  }
  const unhealthyCount =
    counts.invalid_coordinates +
    counts.invalid_motion +
    counts.invalid_source_time +
    counts.migration_missing +
    counts.missing_vessel +
    counts.unstable_sailing +
    counts.write_failed;
  let outcome: LeaderboardVesselSnapshotBatchOutcome = "complete";
  // prioritize deployment failures
  if (counts.migration_missing > 0) {
    outcome = "migration_missing";
    // classify other degradation
  } else if (unhealthyCount > 0) {
    outcome = "degraded";
  }
  const health: LeaderboardVesselSnapshotBatchHealth = {
    counts,
    // derive aggregate ingest health
    ingestHealthy: outcome === "complete",
    outcome,
    receivedAtMs,
    vesselDetectorEnabled: false,
  };
  runtimeHealth = {
    ...runtimeHealth,
    ingestHealthy: health.ingestHealthy,
    lastIngestOutcome: outcome,
  };
  reportBatchHealth(health);
  return health;
};

/** prune only rows whose full configured retention elapsed */
export const pruneLeaderboardVesselVerificationSnapshots = async (
  options: PruneOptions = {}
): Promise<number> => {
  // anchor the server prune time
  const nowMs = options.nowMs ?? Date.now();
  // select the durable store
  const persistence =
    options.persistence ?? leaderboardVesselSnapshotPostgresPersistence;
  // validate server clock and no-shorter policy
  if (!Number.isSafeInteger(nowMs) || nowMs <= 0) {
    runtimeHealth = {
      ...runtimeHealth,
      lastPruneOutcome: "prune_failed",
      pruneHealthy: false,
    };
    return 0;
  }
  // validate retention before deleting
  try {
    leaderboardVesselSnapshotRetentionMs(
      options.policy ?? DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY
    );
    const deleted = await persistence.prune(nowMs);
    runtimeHealth = {
      ...runtimeHealth,
      lastPruneOutcome: "pruned",
      pruneHealthy: true,
    };
    return deleted;
  } catch {
    runtimeHealth = {
      ...runtimeHealth,
      lastPruneOutcome: "prune_failed",
      pruneHealthy: false,
    };
    return 0;
  }
};

// choose one fixed readiness reason
const readinessReason = (input: {
  capacityHealthy: boolean;
  durationHealthy: boolean;
  gapHealthy: boolean;
  ingestHealthy: boolean;
  migrationDeployed: boolean;
  missingRequiredSailingCount: number;
  pruneHealthy: boolean;
  sourceHealthy: boolean;
}): LeaderboardVesselHistoryReadinessReason => {
  // preserve fixed priority
  if (!input.migrationDeployed) {
    return "migration_missing";
  }
  // require healthy ingestion
  if (!input.ingestHealthy) {
    return "ingest_unhealthy";
  }
  // require successful retention
  if (!input.pruneHealthy) {
    return "prune_unhealthy";
  }
  // block on storage capacity
  if (!input.capacityHealthy) {
    return "capacity_unhealthy";
  }
  // require the exact warm duration
  if (!input.durationHealthy) {
    return "history_short";
  }
  // require bounded source lag
  if (!input.sourceHealthy) {
    return "source_lag";
  }
  // require bounded source gaps
  if (!input.gapHealthy) {
    return "source_gap";
  }
  // require every active sailing
  if (input.missingRequiredSailingCount > 0) {
    return "missing_sailing";
  }
  return "ready";
};

/** evaluate durable S1 warm-up without enabling the detector */
export const evaluateLeaderboardVesselHistoryReadiness = async (
  options: ReadinessOptions
): Promise<LeaderboardVesselHistoryReadiness> => {
  // anchor the readiness clock
  const nowMs = options.nowMs ?? Date.now();
  // select the durable store
  const persistence =
    options.persistence ?? leaderboardVesselSnapshotPostgresPersistence;
  // select the capacity threshold
  const maxRows = options.maxRows ?? LEADERBOARD_VESSEL_MAX_ROWS;
  let policy: LeaderboardVesselSnapshotPolicy;
  let retentionMs: number;
  // reject unsafe readiness inputs
  try {
    policy = validatePolicy(
      options.policy ?? DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY
    );
    retentionMs = leaderboardVesselSnapshotRetentionMs(policy);
    // reject invalid clocks and capacity
    if (
      !Number.isSafeInteger(nowMs) ||
      nowMs <= 0 ||
      !Number.isSafeInteger(maxRows) ||
      maxRows <= 0
    ) {
      throw new Error("invalid_snapshot_policy");
    }
  } catch {
    return {
      capacityHealthy: false,
      coverageDurationMs: 0,
      gapHealthy: false,
      ingestHealthy: false,
      missingRequiredSailingCount: options.requiredSailingIds.length,
      pruneHealthy: runtimeHealth.pruneHealthy,
      reason: "invalid_policy",
      retentionMs: 0,
      sourceHealthy: false,
      vesselDetectorEnabled: false,
      vesselHistoryReady: false,
    };
  }
  let migrationDeployed = false;
  let coverage: LeaderboardVesselSnapshotCoverage | null = null;
  // load only aggregate persistence evidence
  try {
    migrationDeployed = await persistence.isDeployed();
    // read coverage only after deployment
    if (migrationDeployed) {
      coverage = await persistence.readCoverage();
    }
  } catch {
    migrationDeployed = false;
  }
  // read durable coverage bounds
  const earliest = coverage?.earliestSourceObservedAtMs ?? null;
  const latest = coverage?.latestSourceObservedAtMs ?? null;
  // measure the durable window
  const coverageDurationMs =
    earliest === null || latest === null ? 0 : Math.max(0, latest - earliest);
  const durationHealthy = coverageDurationMs >= retentionMs;
  const sourceHealthy =
    coverage?.maxSourceLagMs !== null &&
    coverage?.maxSourceLagMs !== undefined &&
    coverage.maxSourceLagMs <= policy.sourceCeilingMs &&
    latest !== null &&
    latest <= nowMs + policy.futureCeilingMs;
  // measure the current source gap
  const latestGapMs =
    latest === null ? Number.POSITIVE_INFINITY : nowMs - latest;
  const gapHealthy =
    coverage?.maxGapMs !== null &&
    coverage?.maxGapMs !== undefined &&
    coverage.maxGapMs <= policy.gapCeilingMs &&
    latestGapMs >= -policy.futureCeilingMs &&
    latestGapMs <= policy.gapCeilingMs;
  const capacityHealthy = coverage !== null && coverage.totalRows <= maxRows;
  // index per-sailing aggregates
  const sailingCoverage = new Map(
    // pair each fixed sailing aggregate
    (coverage?.sailings ?? []).map((sailing) => [sailing.sailingId, sailing])
  );
  let missingRequiredSailingCount = 0;
  // require two bounded observations per requested sailing
  for (const sailingId of new Set(options.requiredSailingIds)) {
    const sailing = sailingCoverage.get(sailingId);
    // count missing or unbracketable sailings
    if (
      !sailing ||
      sailing.rowCount < 2 ||
      sailing.maxGapMs > policy.gapCeilingMs
    ) {
      missingRequiredSailingCount += 1;
    }
  }
  const reason = readinessReason({
    capacityHealthy,
    durationHealthy,
    gapHealthy,
    ingestHealthy: runtimeHealth.ingestHealthy,
    migrationDeployed,
    missingRequiredSailingCount,
    pruneHealthy: runtimeHealth.pruneHealthy,
    sourceHealthy,
  });
  return {
    capacityHealthy,
    coverageDurationMs,
    gapHealthy,
    ingestHealthy: runtimeHealth.ingestHealthy,
    missingRequiredSailingCount,
    pruneHealthy: runtimeHealth.pruneHealthy,
    reason,
    retentionMs,
    sourceHealthy,
    vesselDetectorEnabled: false,
    // enable only complete readiness
    vesselHistoryReady: reason === "ready",
  };
};

/** expose only fixed aggregate runtime health */
export const getLeaderboardVesselSnapshotRuntimeHealth =
  (): LeaderboardVesselSnapshotRuntimeHealth => ({ ...runtimeHealth });

/** reset process-local health for isolated validation */
export const resetLeaderboardVesselSnapshotRuntimeHealthForTests = (): void => {
  // restrict reset to test processes
  if (process.env.NODE_ENV !== "test") {
    return;
  }
  runtimeHealth = {
    ingestHealthy: false,
    lastIngestOutcome: "not_observed",
    lastPruneOutcome: "not_observed",
    pruneHealthy: false,
    vesselDetectorEnabled: false,
  };
};
