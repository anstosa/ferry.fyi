import { createRequire } from "node:module";

import { QueryTypes, Sequelize, type Transaction } from "sequelize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  acquirePostgresIntegrationLock,
  POSTGRES_INTEGRATION_HOOK_TIMEOUT_MS,
} from "./helpers/postgresIntegrationLock";

const require = createRequire(import.meta.url);
const createFeatureFlags = require("../../server/migrations/20260724000200-create-feature-flags.js");
const createAutomaticFlag = require("../../server/migrations/20260724000300-add-automatic-checkins-feature-flag.js");
const addFeatureControls = require("../../server/migrations/20260724000400-add-feature-flag-controls.js");
const addPolicyGeneration = require("../../server/migrations/20260817000600-add-server-policy-generation-to-feature-flags.js");
const externalDatabaseUrl =
  process.env.LEADERBOARD_AUTOMATIC_POLICY_TEST_DATABASE_URL;
// gate real database coverage
const describePostgres = externalDatabaseUrl ? describe : describe.skip;

// cover durable policy serialization
describePostgres("leaderboard automatic policy Postgres integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const schemaName = `leaderboard_policy_${process.pid}_${Date.now()}`;
  let admin: Sequelize;
  let coordination: Transaction;
  let database: Sequelize;
  let updateFeatureFlagState: typeof import("../../server/lib/leaderboardFlags").updateFeatureFlagState;
  let withLeaderboardAutomaticPolicyTransaction: typeof import("../../server/lib/leaderboardAutomaticPolicy").withLeaderboardAutomaticPolicyTransaction;

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
    process.env.DATABASE_URL = url.toString();
    const databaseModule = await import("../../server/lib/db");
    database = databaseModule.db;
    database.options.define = {
      ...database.options.define,
      schema: schemaName,
    };
    await database.authenticate();
    const queryInterface = database.getQueryInterface();
    // scope one migration table
    const table = (tableName: string) => ({ schema: schemaName, tableName });
    const scopedQueryInterface = {
      // scope added columns
      addColumn: (tableName: string, ...args: unknown[]) =>
        queryInterface.addColumn(
          table(tableName),
          ...(args as [string, object])
        ),
      // scope seeded rows
      bulkInsert: (tableName: string, ...args: unknown[]) =>
        queryInterface.bulkInsert(table(tableName), ...(args as [object[]])),
      // scope created tables
      createTable: (tableName: string, ...args: unknown[]) =>
        queryInterface.createTable(table(tableName), ...(args as [object])),
    };
    await createFeatureFlags.up(scopedQueryInterface, Sequelize);
    await createAutomaticFlag.up(scopedQueryInterface, Sequelize);
    await addFeatureControls.up(scopedQueryInterface, Sequelize);
    await addPolicyGeneration.up(scopedQueryInterface, Sequelize);
    const { updateFeatureFlagState: updateFlag } =
      await import("../../server/lib/leaderboardFlags");
    updateFeatureFlagState = updateFlag;
    ({ withLeaderboardAutomaticPolicyTransaction } =
      await import("../../server/lib/leaderboardAutomaticPolicy"));
  }, POSTGRES_INTEGRATION_HOOK_TIMEOUT_MS);

  // remove only the isolated integration schema
  afterAll(async () => {
    // close the scoped runtime pool
    if (database) {
      await database.close();
    }
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);

    // restore the test process environment
    // restore a missing original value
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      // restore the original value
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    await coordination.commit();
    await admin.close();
  });

  // prove partial mutations serialize without stale-field clobber
  it("preserves concurrent enable and kill writes with two generations", async () => {
    await Promise.all([
      updateFeatureFlagState("automaticLeaderboardCheckins", {
        enabled: true,
      }),
      updateFeatureFlagState("automaticLeaderboardCheckins", {
        killSwitch: true,
      }),
    ]);

    const [rows] = await database.query(
      `SELECT "enabled", "killSwitch", "serverPolicyGeneration" FROM "FeatureFlags" WHERE "name" = 'automaticLeaderboardCheckins'`
    );
    expect(rows).toEqual([
      {
        enabled: true,
        killSwitch: true,
        serverPolicyGeneration: "2",
      },
    ]);
  });

  // prove real rollback sqlstates restart the complete policy transaction
  it.each(["40001", "40P01"] as const)(
    "retries a real Postgres %s in a fresh policy transaction",
    async (code) => {
      const transactionIds: string[] = [];
      const transactions: Transaction[] = [];
      let callbackAttempts = 0;

      const result = await withLeaderboardAutomaticPolicyTransaction(
        {},
        async (policy) => {
          callbackAttempts += 1;
          transactions.push(policy.transaction);
          const rows = await database.query<{ transactionId: string }>(
            `SELECT txid_current()::text AS "transactionId"`,
            { transaction: policy.transaction, type: QueryTypes.SELECT }
          );
          transactionIds.push(rows[0].transactionId);

          // abort only the first server transaction with the selected sqlstate
          if (callbackAttempts === 1) {
            await database.query(
              `DO $retry$
               BEGIN
                 RAISE EXCEPTION USING ERRCODE = '${code}', MESSAGE = 'forced policy retry';
               END
               $retry$;`,
              { transaction: policy.transaction }
            );
          }

          return callbackAttempts;
        }
      );

      expect(result).toBe(2);
      expect(callbackAttempts).toBe(2);
      expect(transactions[0]).not.toBe(transactions[1]);
      expect(new Set(transactionIds).size).toBe(2);
    }
  );
});
