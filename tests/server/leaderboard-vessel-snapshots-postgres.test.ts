import { createRequire } from "node:module";

import { Sequelize, type Transaction } from "sequelize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type {
  LeaderboardVesselSnapshotPersistence,
  LeaderboardVesselSnapshotRow,
} from "../../server/services/leaderboardVesselSnapshotIngestion";
import {
  acquirePostgresIntegrationLock,
  POSTGRES_INTEGRATION_HOOK_TIMEOUT_MS,
} from "./helpers/postgresIntegrationLock";

const require = createRequire(import.meta.url);
const migration = require("../../server/migrations/20260817000500-create-leaderboard-vessel-verification-snapshots.js");
const externalDatabaseUrl =
  process.env.LEADERBOARD_VESSEL_SNAPSHOT_TEST_DATABASE_URL;
// gate real database coverage
const describePostgres = externalDatabaseUrl ? describe : describe.skip;

// cover durable Postgres behavior
describePostgres("leaderboard vessel snapshot Postgres integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const schemaName = `leaderboard_snapshot_${process.pid}_${Date.now()}`;
  let admin: Sequelize;
  let coordination: Transaction;
  let database: Sequelize;
  let storageRetentionMs: number;
  let scopedDatabaseUrl: string;
  let store: LeaderboardVesselSnapshotPersistence;

  // create one isolated real Postgres schema
  beforeAll(async () => {
    admin = new Sequelize(externalDatabaseUrl as string, {
      dialect: "postgres",
      logging: false,
    });
    coordination = await acquirePostgresIntegrationLock(admin);
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    const url = new URL(externalDatabaseUrl as string);
    url.searchParams.set("options", `-c search_path=${schemaName}`);
    scopedDatabaseUrl = url.toString();
    process.env.DATABASE_URL = scopedDatabaseUrl;
    const databaseModule = await import("../../server/lib/db");
    const service =
      await import("../../server/services/leaderboardVesselSnapshotIngestion");
    database = databaseModule.db;
    store = service.leaderboardVesselSnapshotPostgresPersistence;
    storageRetentionMs =
      service.LEADERBOARD_VESSEL_SNAPSHOT_STORAGE_RETENTION_MS;
    await database.authenticate();
    await migration.up(database.getQueryInterface(), Sequelize);
  }, POSTGRES_INTEGRATION_HOOK_TIMEOUT_MS);

  // remove only the isolated integration schema
  afterAll(async () => {
    // close the scoped runtime pool
    if (database) {
      await database.close();
    }
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    // restore the test process environment
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    await coordination.commit();
    await admin.close();
  });

  // build one valid retained public row
  const row = (
    sourceObservedAtMs: number,
    vesselId = "probe"
  ): LeaderboardVesselSnapshotRow => ({
    arrivingTerminalId: 2,
    departedAtSeconds: Math.floor(sourceObservedAtMs / 1000) - 60,
    departingTerminalId: 1,
    headingDegrees: 270,
    inMaintenance: false,
    inService: true,
    isAtDock: false,
    latitude: 47.61,
    longitude: -122.43,
    minuteBucketStartMs: Math.floor(sourceObservedAtMs / 60_000) * 60_000,
    receivedAtMs: sourceObservedAtMs + 5_000,
    retainUntilMs: sourceObservedAtMs + storageRetentionMs,
    sailingId: `${vesselId}:${Math.floor(sourceObservedAtMs / 1000) - 60}:1:2`,
    sourceObservedAtMs,
    speedKnots: 14.2,
    vesselId,
  });

  // prove durable concurrency, retention, and reconnect semantics
  it("keeps newest concurrent observations across prune and restart", async () => {
    expect(await store.isDeployed()).toBe(true);
    const sourceBase = Math.floor((Date.now() - 60_000) / 60_000) * 60_000;
    const newer = row(sourceBase + 50_000);
    const older = row(sourceBase + 10_000);

    await Promise.all([store.upsertNewest(newer), store.upsertNewest(older)]);
    const [sameBucketRows] = await database.query(
      `SELECT "sourceObservedAtMs" FROM "LeaderboardVesselVerificationSnapshots" WHERE "vesselId" = 'probe'`
    );
    expect(
      (sameBucketRows[0] as { sourceObservedAtMs: string }).sourceObservedAtMs
    ).toBe(String(newer.sourceObservedAtMs));

    await store.upsertNewest(row(sourceBase + 61_000));
    const [adjacentRows] = await database.query(
      `SELECT count(*) AS count FROM "LeaderboardVesselVerificationSnapshots" WHERE "vesselId" = 'probe'`
    );
    expect((adjacentRows[0] as { count: string }).count).toBe("2");

    const elapsedSource =
      Math.floor((Date.now() - storageRetentionMs - 120_000) / 60_000) * 60_000;
    const elapsed = row(elapsedSource + 1_000, "elapsed");
    await store.upsertNewest(elapsed);
    await expect(store.prune(elapsed.retainUntilMs)).resolves.toBe(1);

    await store.upsertNewest(row(sourceBase + 20_000, "retained"));
    await expect(
      database.query(
        `DELETE FROM "LeaderboardVesselVerificationSnapshots" WHERE "vesselId" = 'retained'`
      )
    ).rejects.toThrow("retention has not elapsed");
    const [retainedRows] = await database.query(
      `SELECT count(*) AS count FROM "LeaderboardVesselVerificationSnapshots" WHERE "vesselId" = 'retained'`
    );
    expect((retainedRows[0] as { count: string }).count).toBe("1");

    const reconnect = new Sequelize(scopedDatabaseUrl, {
      dialect: "postgres",
      logging: false,
    });
    await reconnect.authenticate();
    const [restartRows] = await reconnect.query(
      `SELECT count(*) AS count FROM "LeaderboardVesselVerificationSnapshots"`
    );
    expect((restartRows[0] as { count: string }).count).toBe("3");
    await reconnect.close();
  });
});
