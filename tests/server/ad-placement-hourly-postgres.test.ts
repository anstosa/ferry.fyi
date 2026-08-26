import { createRequire } from "node:module";

import { QueryTypes, Sequelize, type Transaction } from "sequelize";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  acquirePostgresIntegrationLock,
  POSTGRES_INTEGRATION_HOOK_TIMEOUT_MS,
} from "./helpers/postgresIntegrationLock";

const require = createRequire(import.meta.url);
const createPublicContent = require("../../server/migrations/20260724000800-create-public-content-controls.js");
const createAdPlacements = require("../../server/migrations/20260804000100-create-ad-placements.js");
const createAdTracking = require("../../server/migrations/20260804000200-create-ad-tracking.js");
const createHourlyMetrics = require("../../server/migrations/20260820000100-create-ad-placement-hourly-metrics.js");
const preserveAdCtaLabels = require("../../server/migrations/20260821000100-preserve-ad-cta-labels.js");
const externalDatabaseUrl = process.env.AD_PLACEMENT_HOURLY_TEST_DATABASE_URL;
// gate real database coverage
const describePostgres = externalDatabaseUrl ? describe : describe.skip;

// cover hourly migration and roll-up behavior
describePostgres("ad placement hourly Postgres integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const schemaName = `ad_hourly_${process.pid}_${Date.now()}`;
  let admin: Sequelize;
  let claimAdExposure: typeof import("../../server/services/public/adTracking").claimAdExposure;
  let coordination: Transaction;
  let database: Sequelize;
  let issueAdExposure: typeof import("../../server/services/public/adTracking").issueAdExposure;

  // scope migration tables to the isolated schema
  const scopedQueryInterface = () => {
    const queryInterface = database.getQueryInterface();
    // qualify one migration table
    const table = (tableName: string) => ({ schema: schemaName, tableName });
    // invoke one scoped query-interface method
    const scopedCall = (
      method: (...argumentsList: never[]) => unknown,
      tableName: string,
      argumentsList: unknown[]
    ) =>
      Reflect.apply(method, queryInterface, [
        table(tableName),
        ...argumentsList,
      ]);
    return {
      ...queryInterface,
      addColumn: (tableName: string, ...argumentsList: unknown[]) =>
        scopedCall(queryInterface.addColumn, tableName, argumentsList),
      addConstraint: (tableName: string, ...argumentsList: unknown[]) =>
        scopedCall(queryInterface.addConstraint, tableName, argumentsList),
      addIndex: (tableName: string, ...argumentsList: unknown[]) =>
        scopedCall(queryInterface.addIndex, tableName, argumentsList),
      changeColumn: (tableName: string, ...argumentsList: unknown[]) =>
        scopedCall(queryInterface.changeColumn, tableName, argumentsList),
      createTable: (tableName: string, ...argumentsList: unknown[]) =>
        scopedCall(queryInterface.createTable, tableName, argumentsList),
      describeTable: (tableName: string, ...argumentsList: unknown[]) =>
        scopedCall(queryInterface.describeTable, tableName, argumentsList),
      sequelize: queryInterface.sequelize,
    };
  };

  // create one isolated pre-migration schema
  beforeAll(async () => {
    admin = new Sequelize(externalDatabaseUrl as string, {
      dialect: "postgres",
      logging: false,
    });
    coordination = await acquirePostgresIntegrationLock(admin);
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    const url = new URL(externalDatabaseUrl as string);
    url.searchParams.set("options", `-c search_path=${schemaName}`);
    process.env.DATABASE_URL = url.toString();
    vi.resetModules();
    const databaseModule = await import("../../server/lib/db");
    database = databaseModule.db;
    database.options.define = {
      ...database.options.define,
      schema: schemaName,
    };
    await databaseModule.dbInit;
    const queryInterface = scopedQueryInterface();
    await createPublicContent.up(queryInterface, Sequelize);
    await createAdPlacements.up(queryInterface, Sequelize);
    await createAdTracking.up(queryInterface, Sequelize);
    // match the current placement model
    await preserveAdCtaLabels.up(queryInterface, Sequelize);
    const createdAt = new Date("2026-08-05T06:30:00.000Z");
    await database.query(
      `INSERT INTO "AdPlacements"
        ("key", "slot", "departureTerminalId", "arrivalTerminalId", "enabled", "advertiserName", "headline", "body", "targetUrl", "createdAt", "updatedAt")
       VALUES ('home', 'home', NULL, NULL, false, '', '', '', '', :createdAt, :createdAt)`,
      { replacements: { createdAt } }
    );
    await database.query(
      `INSERT INTO "AdMeasurementExposures"
        ("tokenHash", "placementKey", "campaignId", "businessDate", "servable", "opportunityClaimed", "servedClaimed", "viewableClaimed", "clickClaimed", "expiresAt", "createdAt", "updatedAt")
       VALUES (:tokenHash, 'home', NULL, '2026-08-04', false, false, false, false, false, :expiresAt, :createdAt, :createdAt)`,
      {
        replacements: {
          createdAt,
          expiresAt: new Date("2026-08-05T08:30:00.000Z"),
          tokenHash: "a".repeat(64),
        },
      }
    );
    await createHourlyMetrics.up(queryInterface, Sequelize);
    const tracking = await import("../../server/services/public/adTracking");
    ({ claimAdExposure, issueAdExposure } = tracking);
  }, POSTGRES_INTEGRATION_HOOK_TIMEOUT_MS);

  // remove only the isolated integration schema
  afterAll(async () => {
    // close the scoped runtime pool
    if (database) {
      await database.close();
    }
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    // restore the process environment
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    await coordination.commit();
    await admin.close();
  });

  // prove migration backfill, default, and constraints
  it("enforces valid Pacific exposure hours", async () => {
    const legacyRows = await database.query<{ businessHour: number }>(
      `SELECT "businessHour" FROM "AdMeasurementExposures" WHERE "tokenHash" = :tokenHash`,
      {
        replacements: { tokenHash: "a".repeat(64) },
        type: QueryTypes.SELECT,
      }
    );
    expect(legacyRows[0].businessHour).toBe(23);

    const timestamp = new Date();
    await database.query(
      `INSERT INTO "AdMeasurementExposures"
        ("tokenHash", "placementKey", "campaignId", "businessDate", "servable", "opportunityClaimed", "servedClaimed", "viewableClaimed", "clickClaimed", "expiresAt", "createdAt", "updatedAt")
       VALUES (:tokenHash, 'home', NULL, '2026-08-20', false, false, false, false, false, :expiresAt, :timestamp, :timestamp)`,
      {
        replacements: {
          expiresAt: new Date(timestamp.getTime() + 60_000),
          timestamp,
          tokenHash: "b".repeat(64),
        },
      }
    );
    const defaultRows = await database.query<{ businessHour: number }>(
      `SELECT "businessHour" FROM "AdMeasurementExposures" WHERE "tokenHash" = :tokenHash`,
      {
        replacements: { tokenHash: "b".repeat(64) },
        type: QueryTypes.SELECT,
      }
    );
    expect(defaultRows[0].businessHour).toBeGreaterThanOrEqual(0);
    expect(defaultRows[0].businessHour).toBeLessThanOrEqual(23);
    await expect(
      database.query(
        `UPDATE "AdMeasurementExposures" SET "businessHour" = 24 WHERE "tokenHash" = :tokenHash`,
        { replacements: { tokenHash: "b".repeat(64) } }
      )
    ).rejects.toThrow();
  });

  // prove one claim updates both aggregate grains
  it("rolls one opportunity into matching hourly and daily totals", async () => {
    const now = new Date("2026-08-05T16:00:00.000Z");
    const exposure = await issueAdExposure("home", now);
    // require the issued measurement token
    if (!exposure.token) {
      throw new Error("expected ad exposure token");
    }

    await claimAdExposure(
      exposure.token,
      "opportunity",
      undefined,
      new Date(now.getTime() + 1_000)
    );

    const dailyRows = await database.query<{ opportunityCount: string }>(
      `SELECT "opportunityCount" FROM "AdPlacementDailyMetrics"
       WHERE "businessDate" = '2026-08-05' AND "placementKey" = 'home'`,
      { type: QueryTypes.SELECT }
    );
    const hourlyRows = await database.query<{
      businessHour: number;
      opportunityCount: string;
    }>(
      `SELECT "businessHour", "opportunityCount" FROM "AdPlacementHourlyMetrics"
       WHERE "businessDate" = '2026-08-05' AND "placementKey" = 'home'`,
      { type: QueryTypes.SELECT }
    );
    expect(dailyRows[0]).toMatchObject({ opportunityCount: "1" });
    expect(hourlyRows[0]).toMatchObject({
      businessHour: 9,
      opportunityCount: "1",
    });
  });
});
