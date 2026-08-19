import { createRequire } from "node:module";

import { beforeEach, describe, expect, it, vi } from "vitest";

// isolate database access
const database = vi.hoisted(() => ({ query: vi.fn() }));
// isolate vessel metadata
const vesselModel = vi.hoisted(() => ({ getByIndex: vi.fn() }));

// silence fixed logger output
vi.mock("heroku-logger", () => ({
  default: { info: vi.fn() },
}));

// provide the database double
vi.mock("~/lib/db", () => ({ db: database }));

// provide the vessel double
vi.mock("~/models/Vessel", () => ({ Vessel: vesselModel }));

import {
  DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY,
  evaluateLeaderboardVesselHistoryReadiness,
  getLeaderboardVesselSnapshotRuntimeHealth,
  ingestLeaderboardVesselStatusRefresh,
  LEADERBOARD_VESSEL_SNAPSHOT_PRE_FREEZE_RETENTION_MS,
  LEADERBOARD_VESSEL_SNAPSHOT_STORAGE_RETENTION_MS,
  type LeaderboardVesselSnapshotCoverage,
  type LeaderboardVesselSnapshotPersistence,
  leaderboardVesselSnapshotPostgresPersistence,
  leaderboardVesselSnapshotRetentionMs,
  type LeaderboardVesselSnapshotRow,
  leaderboardVesselSnapshotStorageRetentionMs,
  pruneLeaderboardVesselVerificationSnapshots,
  recordSkippedLeaderboardVesselStatusRefresh,
  resetLeaderboardVesselSnapshotRuntimeHealthForTests,
} from "../../server/services/leaderboardVesselSnapshotIngestion";
import type { WSF } from "../../server/typings/wsf";

const require = createRequire(import.meta.url);
const migration = require("../../server/migrations/20260817000500-create-leaderboard-vessel-verification-snapshots.js");

const RECEIVED_AT_MS = Date.parse("2026-08-17T12:00:30.000Z");
const SOURCE_AT_MS = RECEIVED_AT_MS - 4_877;
const LEFT_DOCK_SECONDS = Math.floor(RECEIVED_AT_MS / 1000) - 60;

// build one WSF date fixture
const wsfDate = (milliseconds: number): string =>
  `/Date(${milliseconds}-0700)/`;

// build one public WSF observation
const location = (
  overrides: Partial<WSF.VesselsLocationResponse> = {}
): WSF.VesselsLocationResponse => ({
  ArrivingTerminalAbbrev: "BAI",
  ArrivingTerminalID: 2,
  ArrivingTerminalName: "Bainbridge Island",
  AtDock: false,
  DepartingTerminalAbbrev: "SEA",
  DepartingTerminalID: 1,
  DepartingTerminalName: "Seattle",
  Heading: 270,
  InService: true,
  Latitude: 47.61,
  LeftDock: wsfDate(LEFT_DOCK_SECONDS * 1000),
  Longitude: -122.43,
  ManagedBy: 1,
  OpRouteAbbrev: ["sea-bi"],
  SortSeq: 1,
  Speed: 14.2,
  TimeStamp: wsfDate(SOURCE_AT_MS),
  VesselID: 123,
  VesselName: "Test Vessel",
  ...overrides,
});

// create injectable persistence state
const persistence = (
  coverage?: Partial<LeaderboardVesselSnapshotCoverage>
): LeaderboardVesselSnapshotPersistence & {
  prune: ReturnType<typeof vi.fn>;
  upsertNewest: ReturnType<typeof vi.fn>;
} => ({
  isDeployed: vi.fn().mockResolvedValue(true),
  prune: vi.fn().mockResolvedValue(0),
  readCoverage: vi.fn().mockResolvedValue({
    earliestSourceObservedAtMs: null,
    latestSourceObservedAtMs: null,
    maxGapMs: null,
    maxSourceLagMs: null,
    sailings: [],
    totalRows: 0,
    ...coverage,
  }),
  upsertNewest: vi.fn().mockResolvedValue("stored"),
});

// create a deterministic retained-row lifecycle store
const memoryPersistence = (): LeaderboardVesselSnapshotPersistence => {
  const rows = new Map<string, LeaderboardVesselSnapshotRow>();
  return {
    // report the in-memory migration as deployed
    isDeployed: () => Promise.resolve(true),
    // delete only exact elapsed retention rows
    prune: (nowMs: number): Promise<number> => {
      let deleted = 0;
      // inspect every retained bucket
      for (const [key, row] of rows) {
        // delete only elapsed rows
        if (row.retainUntilMs <= nowMs) {
          rows.delete(key);
          deleted += 1;
        }
      }
      return Promise.resolve(deleted);
    },
    // derive aggregate coverage from retained rows
    readCoverage: (): Promise<LeaderboardVesselSnapshotCoverage> => {
      const retained = [...rows.values()];
      const sourceTimes = [
        // collect unique source times
        ...new Set(
          // read each retained source
          retained.map(({ sourceObservedAtMs }) => sourceObservedAtMs)
        ),
      ].sort(
        // order source times
        (left, right) => left - right
      );
      const gaps = sourceTimes.slice(1).map(
        // measure adjacent production observations
        (source, index) => source - sourceTimes[index]
      );
      return Promise.resolve({
        earliestSourceObservedAtMs: sourceTimes[0] ?? null,
        latestSourceObservedAtMs: sourceTimes.at(-1) ?? null,
        // preserve insufficient gap evidence
        maxGapMs: gaps.length > 0 ? Math.max(...gaps) : null,
        // preserve insufficient lag evidence
        maxSourceLagMs:
          retained.length > 0
            ? Math.max(
                // measure every source lag
                ...retained.map(
                  // compare receive and source clocks
                  ({ receivedAtMs, sourceObservedAtMs }) =>
                    receivedAtMs - sourceObservedAtMs
                )
              )
            : null,
        sailings: [],
        totalRows: retained.length,
      });
    },
    // preserve only the newest source in each minute
    upsertNewest: (
      row: LeaderboardVesselSnapshotRow
    ): Promise<"older_source_ignored" | "stored"> => {
      const key = `${row.vesselId}:${row.minuteBucketStartMs}`;
      const current = rows.get(key);
      // reject older replay
      if (current && current.sourceObservedAtMs >= row.sourceObservedAtMs) {
        return Promise.resolve("older_source_ignored");
      }
      rows.set(key, row);
      return Promise.resolve("stored");
    },
  };
};

// build exact warm aggregate coverage
const warmCoverage = (
  overrides: Partial<LeaderboardVesselSnapshotCoverage> = {}
): LeaderboardVesselSnapshotCoverage => ({
  earliestSourceObservedAtMs:
    RECEIVED_AT_MS - LEADERBOARD_VESSEL_SNAPSHOT_PRE_FREEZE_RETENTION_MS,
  latestSourceObservedAtMs: RECEIVED_AT_MS,
  maxGapMs: DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY.gapCeilingMs,
  maxSourceLagMs: DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY.sourceCeilingMs,
  sailings: [
    {
      maxGapMs: DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY.gapCeilingMs,
      rowCount: 2,
      sailingId: `123:${LEFT_DOCK_SECONDS}:1:2`,
    },
  ],
  totalRows: 1_000,
  ...overrides,
});

// mark current-process ingestion healthy
const markIngestHealthy = async (
  store: LeaderboardVesselSnapshotPersistence
): Promise<void> => {
  await ingestLeaderboardVesselStatusRefresh([location()], {
    persistence: store,
    receivedAtMs: RECEIVED_AT_MS,
  });
};

// mark both production lifecycle stages healthy
const markRuntimeHealthy = async (
  store: LeaderboardVesselSnapshotPersistence
): Promise<void> => {
  await markIngestHealthy(store);
  await pruneLeaderboardVesselVerificationSnapshots({
    nowMs: RECEIVED_AT_MS,
    persistence: store,
  });
};

// cover snapshot ingestion behavior
describe("leaderboard vessel snapshot ingestion", () => {
  // reset process-local health and doubles
  beforeEach(() => {
    vi.clearAllMocks();
    resetLeaderboardVesselSnapshotRuntimeHealthForTests();
    vesselModel.getByIndex.mockReturnValue({ inMaintenance: false });
  });

  // prove every conservative term contributes
  it("computes the exact no-shorter pre-freeze retention", () => {
    const policy = DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY;

    expect(leaderboardVesselSnapshotRetentionMs()).toBe(
      policy.candidateRetentionMs +
        policy.futureCeilingMs +
        policy.sourceCeilingMs +
        policy.gapCeilingMs +
        policy.processingCeilingMs
    );
    // reject reduced conservative terms
    expect(() =>
      leaderboardVesselSnapshotRetentionMs({
        ...policy,
        gapCeilingMs: policy.gapCeilingMs - 1,
      })
    ).toThrow("invalid_snapshot_policy");
    expect(leaderboardVesselSnapshotStorageRetentionMs()).toBe(
      LEADERBOARD_VESSEL_SNAPSHOT_PRE_FREEZE_RETENTION_MS +
        2 * policy.gapCeilingMs
    );
  });

  // prove source seconds and receive milliseconds stay separate
  it("stores one unit-explicit public vessel observation", async () => {
    const store = persistence();

    const health = await ingestLeaderboardVesselStatusRefresh([location()], {
      persistence: store,
      receivedAtMs: RECEIVED_AT_MS,
    });

    expect(health).toEqual(
      expect.objectContaining({ ingestHealthy: true, outcome: "complete" })
    );
    expect(store.upsertNewest).toHaveBeenCalledWith({
      arrivingTerminalId: 2,
      departedAtSeconds: LEFT_DOCK_SECONDS,
      departingTerminalId: 1,
      headingDegrees: 270,
      inMaintenance: false,
      inService: true,
      isAtDock: false,
      latitude: 47.61,
      longitude: -122.43,
      minuteBucketStartMs: Math.floor(SOURCE_AT_MS / 60_000) * 60_000,
      receivedAtMs: RECEIVED_AT_MS,
      retainUntilMs:
        SOURCE_AT_MS + LEADERBOARD_VESSEL_SNAPSHOT_STORAGE_RETENTION_MS,
      sailingId: `123:${LEFT_DOCK_SECONDS}:1:2`,
      sourceObservedAtMs: SOURCE_AT_MS,
      speedKnots: 14.2,
      vesselId: "123",
    });
  });

  // retain non-sailing state inputs
  it.each([
    ["docked", { ArrivingTerminalID: null, AtDock: true, LeftDock: undefined }],
    [
      "out-of-service",
      { ArrivingTerminalID: null, InService: false, LeftDock: undefined },
    ],
  ])(
    "retains valid %s public states without a sailing id",
    // validate each non-sailing state
    async (_label, state) => {
      const store = persistence();

      await ingestLeaderboardVesselStatusRefresh([location(state)], {
        persistence: store,
        receivedAtMs: RECEIVED_AT_MS,
      });

      expect(store.upsertNewest).toHaveBeenCalledWith(
        expect.objectContaining({
          arrivingTerminalId: null,
          departedAtSeconds: null,
          sailingId: null,
        })
      );
    }
  );

  // reject unsafe source and position inputs
  it("skips invalid source, coordinate, motion, and sailing observations", async () => {
    const store = persistence();
    const observations = [
      location({ TimeStamp: "invalid" }),
      location({ Latitude: Number.NaN }),
      location({ Speed: Number.POSITIVE_INFINITY }),
      location({ ArrivingTerminalID: null }),
    ];

    const health = await ingestLeaderboardVesselStatusRefresh(observations, {
      persistence: store,
      receivedAtMs: RECEIVED_AT_MS,
    });

    expect(health.counts).toEqual(
      expect.objectContaining({
        invalid_coordinates: 1,
        invalid_motion: 1,
        invalid_source_time: 1,
        unstable_sailing: 1,
      })
    );
    expect(health.ingestHealthy).toBe(false);
    expect(store.upsertNewest).not.toHaveBeenCalled();
  });

  // reject absent external source times without throwing
  it.each([
    ["missing", undefined],
    ["explicit null", null],
  ])(
    "classifies %s WSF source time",
    // validate each absent source shape
    async (_label, timeStamp) => {
      const store = persistence();

      const health = await ingestLeaderboardVesselStatusRefresh(
        [location({ TimeStamp: timeStamp as unknown as string })],
        {
          persistence: store,
          receivedAtMs: RECEIVED_AT_MS,
        }
      );

      expect(health.counts.invalid_source_time).toBe(1);
      expect(health.outcome).toBe("degraded");
      expect(store.upsertNewest).not.toHaveBeenCalled();
    }
  );

  // preserve only fixed aggregate failure output
  it("classifies write failures without observation details", async () => {
    const store = persistence();
    store.upsertNewest.mockRejectedValue(new Error("private database detail"));

    const health = await ingestLeaderboardVesselStatusRefresh([location()], {
      persistence: store,
      receivedAtMs: RECEIVED_AT_MS,
    });

    expect(health.counts.write_failed).toBe(1);
    expect(JSON.stringify(health)).not.toContain("123:");
    expect(JSON.stringify(health)).not.toContain("47.61");
    expect(JSON.stringify(health)).not.toContain("private database detail");
  });

  // block before the migration exists
  it("does not start ingestion before migration deployment", async () => {
    const store = persistence();
    vi.mocked(store.isDeployed).mockResolvedValue(false);

    const health = await ingestLeaderboardVesselStatusRefresh([location()], {
      persistence: store,
      receivedAtMs: RECEIVED_AT_MS,
    });

    expect(health.outcome).toBe("migration_missing");
    expect(store.upsertNewest).not.toHaveBeenCalled();
  });

  // distinguish skipped refreshes from empty history
  it("records skipped refresh health", () => {
    const health = recordSkippedLeaderboardVesselStatusRefresh(RECEIVED_AT_MS);

    expect(health).toEqual(
      expect.objectContaining({ ingestHealthy: false, outcome: "skipped" })
    );
    expect(getLeaderboardVesselSnapshotRuntimeHealth()).toEqual(
      expect.objectContaining({
        ingestHealthy: false,
        lastIngestOutcome: "skipped",
      })
    );
  });

  // require exact retention before pruning
  it("passes the injected exact boundary to durable pruning", async () => {
    const store = persistence();
    store.prune.mockResolvedValue(3);

    await expect(
      pruneLeaderboardVesselVerificationSnapshots({
        nowMs: RECEIVED_AT_MS,
        persistence: store,
      })
    ).resolves.toBe(3);
    expect(store.prune).toHaveBeenCalledWith(RECEIVED_AT_MS);
  });

  // retain rows and degrade readiness after prune failure
  it("fails readiness without retrying a shorter prune", async () => {
    const store = persistence(warmCoverage());
    store.prune.mockRejectedValue(new Error("capacity"));
    await markIngestHealthy(store);

    await expect(
      pruneLeaderboardVesselVerificationSnapshots({
        nowMs: RECEIVED_AT_MS,
        persistence: store,
      })
    ).resolves.toBe(0);
    const readiness = await evaluateLeaderboardVesselHistoryReadiness({
      nowMs: RECEIVED_AT_MS,
      persistence: store,
      requiredSailingIds: [`123:${LEFT_DOCK_SECONDS}:1:2`],
    });

    expect(store.prune).toHaveBeenCalledOnce();
    expect(readiness.reason).toBe("prune_unhealthy");
    expect(readiness.vesselHistoryReady).toBe(false);
  });

  // accept exactly the full warm boundary
  it("becomes warm only at the exact retained coverage boundary", async () => {
    const store = persistence(warmCoverage());
    await markRuntimeHealthy(store);

    const readiness = await evaluateLeaderboardVesselHistoryReadiness({
      nowMs: RECEIVED_AT_MS,
      persistence: store,
      requiredSailingIds: [`123:${LEFT_DOCK_SECONDS}:1:2`],
    });

    expect(readiness).toEqual(
      expect.objectContaining({
        reason: "ready",
        vesselDetectorEnabled: false,
        vesselHistoryReady: true,
      })
    );
  });

  // reject one millisecond short of warm-up
  it("remains warming one millisecond before the boundary", async () => {
    const store = persistence(
      warmCoverage({
        earliestSourceObservedAtMs:
          RECEIVED_AT_MS -
          LEADERBOARD_VESSEL_SNAPSHOT_PRE_FREEZE_RETENTION_MS +
          1,
      })
    );
    await markRuntimeHealthy(store);

    const readiness = await evaluateLeaderboardVesselHistoryReadiness({
      nowMs: RECEIVED_AT_MS,
      persistence: store,
      requiredSailingIds: [`123:${LEFT_DOCK_SECONDS}:1:2`],
    });

    expect(readiness.reason).toBe("history_short");
    expect(readiness.vesselHistoryReady).toBe(false);
  });

  // fail each independent warm-up gate
  it.each([
    [
      "source_lag",
      {
        maxSourceLagMs:
          DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY.sourceCeilingMs + 1,
      },
      [`123:${LEFT_DOCK_SECONDS}:1:2`],
    ],
    [
      "source_gap",
      {
        maxGapMs: DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY.gapCeilingMs + 1,
      },
      [`123:${LEFT_DOCK_SECONDS}:1:2`],
    ],
    ["missing_sailing", {}, ["missing"]],
  ])(
    "fails fixed %s readiness",
    // validate each readiness gate
    async (reason, overrides, sailingIds) => {
      const store = persistence(warmCoverage(overrides));
      await markRuntimeHealthy(store);

      const readiness = await evaluateLeaderboardVesselHistoryReadiness({
        nowMs: RECEIVED_AT_MS,
        persistence: store,
        requiredSailingIds: sailingIds,
      });

      expect(readiness.reason).toBe(reason);
      expect(readiness.vesselHistoryReady).toBe(false);
    }
  );

  // capacity failures never invoke shorter pruning
  it("blocks readiness at capacity without deleting history", async () => {
    const store = persistence(warmCoverage({ totalRows: 11 }));
    await markRuntimeHealthy(store);
    store.prune.mockClear();

    const readiness = await evaluateLeaderboardVesselHistoryReadiness({
      maxRows: 10,
      nowMs: RECEIVED_AT_MS,
      persistence: store,
      requiredSailingIds: [`123:${LEFT_DOCK_SECONDS}:1:2`],
    });

    expect(readiness.reason).toBe("capacity_unhealthy");
    expect(store.prune).not.toHaveBeenCalled();
  });

  // derive warm-up from durable rows after restart
  it("requires a fresh successful prune after process restart", async () => {
    const store = persistence(warmCoverage());
    resetLeaderboardVesselSnapshotRuntimeHealthForTests();
    await markIngestHealthy(store);

    const beforePrune = await evaluateLeaderboardVesselHistoryReadiness({
      nowMs: RECEIVED_AT_MS,
      persistence: store,
      requiredSailingIds: [`123:${LEFT_DOCK_SECONDS}:1:2`],
    });
    await pruneLeaderboardVesselVerificationSnapshots({
      nowMs: RECEIVED_AT_MS,
      persistence: store,
    });
    const afterPrune = await evaluateLeaderboardVesselHistoryReadiness({
      nowMs: RECEIVED_AT_MS,
      persistence: store,
      requiredSailingIds: [`123:${LEFT_DOCK_SECONDS}:1:2`],
    });

    expect(beforePrune.reason).toBe("prune_unhealthy");
    expect(beforePrune.vesselHistoryReady).toBe(false);
    expect(afterPrune.vesselHistoryReady).toBe(true);
    expect(store.readCoverage).toHaveBeenCalled();
  });

  // never erase failed prune health during restart
  it("resets failed prune health to unobserved and unhealthy", async () => {
    const store = persistence(warmCoverage());
    store.prune.mockRejectedValue(new Error("prune failed"));
    await markIngestHealthy(store);
    await pruneLeaderboardVesselVerificationSnapshots({
      nowMs: RECEIVED_AT_MS,
      persistence: store,
    });
    resetLeaderboardVesselSnapshotRuntimeHealthForTests();

    expect(getLeaderboardVesselSnapshotRuntimeHealth()).toEqual(
      expect.objectContaining({
        lastPruneOutcome: "not_observed",
        pruneHealthy: false,
      })
    );
  });

  // keep warm-up stable across exact prune and allowed gaps
  it("stays warm through the production ingest and prune boundary", async () => {
    const store = memoryPersistence();
    const firstSourceAtMs =
      RECEIVED_AT_MS - LEADERBOARD_VESSEL_SNAPSHOT_STORAGE_RETENTION_MS;
    // ingest every scheduled minute through the boundary
    for (
      let sourceObservedAtMs = firstSourceAtMs;
      sourceObservedAtMs <= RECEIVED_AT_MS;
      sourceObservedAtMs += 60_000
    ) {
      await ingestLeaderboardVesselStatusRefresh(
        [
          location({
            ArrivingTerminalID: null,
            AtDock: true,
            LeftDock: undefined,
            TimeStamp: wsfDate(sourceObservedAtMs),
          }),
        ],
        { persistence: store, receivedAtMs: sourceObservedAtMs }
      );
    }

    await pruneLeaderboardVesselVerificationSnapshots({
      nowMs: RECEIVED_AT_MS,
      persistence: store,
    });
    const exactBoundary = await evaluateLeaderboardVesselHistoryReadiness({
      nowMs: RECEIVED_AT_MS,
      persistence: store,
      requiredSailingIds: [],
    });
    const allowedGapBoundary =
      RECEIVED_AT_MS + DEFAULT_LEADERBOARD_VESSEL_SNAPSHOT_POLICY.gapCeilingMs;
    await pruneLeaderboardVesselVerificationSnapshots({
      nowMs: allowedGapBoundary,
      persistence: store,
    });
    const afterAllowedGap = await evaluateLeaderboardVesselHistoryReadiness({
      nowMs: allowedGapBoundary,
      persistence: store,
      requiredSailingIds: [],
    });

    expect(exactBoundary.vesselHistoryReady).toBe(true);
    expect(afterAllowedGap.vesselHistoryReady).toBe(true);
    expect(afterAllowedGap.coverageDurationMs).toBeGreaterThanOrEqual(
      LEADERBOARD_VESSEL_SNAPSHOT_PRE_FREEZE_RETENTION_MS
    );
  });

  // keep the SQL concurrency condition strict
  it("uses a conditional newest-source Postgres upsert", async () => {
    database.query.mockResolvedValueOnce([[{ id: "1" }], {}]);
    // capture one validated row
    const row = {
      // run one isolated validation callback
      ...((await (async () => {
        const store = persistence();
        await ingestLeaderboardVesselStatusRefresh([location()], {
          persistence: store,
          receivedAtMs: RECEIVED_AT_MS,
        });
        return store.upsertNewest.mock.calls[0][0];
      })()) as LeaderboardVesselSnapshotRow),
    };

    await expect(
      leaderboardVesselSnapshotPostgresPersistence.upsertNewest(row)
    ).resolves.toBe("stored");
    const sql = database.query.mock.calls[0][0];
    expect(sql).toContain(
      'ON CONFLICT ("vesselId", "minuteBucketStartMs") DO UPDATE'
    );
    expect(sql).toContain('WHERE EXCLUDED."sourceObservedAtMs" >');
  });
});

// cover migration lifecycle
describe("leaderboard vessel snapshot migration", () => {
  const transaction = { commit: vi.fn(), rollback: vi.fn() };

  // create migration doubles
  const createQueryInterface = () => ({
    addIndex: vi.fn(),
    createTable: vi.fn(),
    dropTable: vi.fn(),
    sequelize: {
      query: vi.fn(),
      transaction: vi.fn().mockResolvedValue(transaction),
    },
  });

  const Sequelize = {
    BIGINT: "BIGINT",
    BOOLEAN: "BOOLEAN",
    DOUBLE: "DOUBLE",
    INTEGER: "INTEGER",
    // model parameterized strings
    STRING: vi.fn((length) => `STRING(${length})`),
  };

  // reset transaction evidence
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // prove unit columns, indexes, and retention guard
  it("creates the retained unit-explicit S1 store", async () => {
    const queryInterface = createQueryInterface();

    await migration.up(queryInterface, Sequelize);

    expect(queryInterface.createTable).toHaveBeenCalledWith(
      "LeaderboardVesselVerificationSnapshots",
      expect.objectContaining({
        departedAtSeconds: expect.objectContaining({ allowNull: true }),
        minuteBucketStartMs: expect.objectContaining({ allowNull: false }),
        receivedAtMs: expect.objectContaining({ allowNull: false }),
        sailingId: expect.objectContaining({ allowNull: true }),
        sourceObservedAtMs: expect.objectContaining({ allowNull: false }),
        vesselId: expect.objectContaining({ allowNull: false }),
      }),
      { transaction }
    );
    expect(queryInterface.addIndex).toHaveBeenCalledWith(
      "LeaderboardVesselVerificationSnapshots",
      ["vesselId", "minuteBucketStartMs"],
      expect.objectContaining({ unique: true })
    );
    expect(queryInterface.addIndex).toHaveBeenCalledWith(
      "LeaderboardVesselVerificationSnapshots",
      ["sailingId", "sourceObservedAtMs"],
      expect.any(Object)
    );
    const guardSql = queryInterface.sequelize.query.mock.calls[0][0];
    expect(guardSql).toContain("protect_leaderboard_vessel_snapshot_retention");
    expect(guardSql).toContain(
      LEADERBOARD_VESSEL_SNAPSHOT_STORAGE_RETENTION_MS.toString()
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // roll back partial deployment
  it("rolls back a failed migration", async () => {
    const queryInterface = createQueryInterface();
    queryInterface.sequelize.query.mockRejectedValue(new Error("sql failed"));

    await expect(migration.up(queryInterface, Sequelize)).rejects.toThrow(
      "sql failed"
    );
    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  // remove only migration-owned objects
  it("drops the retention guard before the owned table", async () => {
    const queryInterface = createQueryInterface();

    await migration.down(queryInterface);

    expect(queryInterface.sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "DROP TRIGGER IF EXISTS protect_leaderboard_vessel_snapshot_retention_trigger"
      ),
      { transaction }
    );
    expect(queryInterface.dropTable).toHaveBeenCalledWith(
      "LeaderboardVesselVerificationSnapshots",
      { transaction }
    );
  });
});
