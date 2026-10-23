import { createRequire } from "node:module";

import {
  type QueryInterface,
  QueryTypes,
  Sequelize,
  type Transaction,
} from "sequelize";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { OpenaiCameraStore } from "../../server/lib/openaiCameraStore";
import type { OpenaiCameraPipelineState } from "../../server/lib/openaiCameraTypes";
import {
  acquirePostgresIntegrationLock,
  POSTGRES_INTEGRATION_HOOK_TIMEOUT_MS,
} from "./helpers/postgresIntegrationLock";

const require = createRequire(import.meta.url);
const migration = require("../../server/migrations/20261023000100-create-openai-camera-pipeline-state.js");
const externalDatabaseUrl = process.env.OPENAI_CAMERA_STORE_TEST_DATABASE_URL;
// opt in only against a caller-provided test database
const describePostgres = externalDatabaseUrl ? describe : describe.skip;

// protect real transaction ownership and jsonb persistence
describePostgres("OpenAI camera store Postgres integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const schemaName = `openai_camera_${process.pid}_${Date.now()}`;
  const table = { schema: schemaName, tableName: "OpenaiCameraPipelineStates" };
  const slot = Date.UTC(2026, 9, 23, 10);
  let admin: Sequelize | undefined;
  let coordination: Transaction | undefined;
  let database: Sequelize | undefined;
  let scopedUrl: string;
  let first: OpenaiCameraStore;
  let second: OpenaiCameraStore;

  // scope the actual migration to this suite's isolated schema
  const migrationInterface = () => ({
    // preserve the migration's real columns and indexes
    createTable: (
      _name: string,
      columns: Parameters<QueryInterface["createTable"]>[1]
    ) => database!.getQueryInterface().createTable(table, columns),
    // remove only this suite's state table
    dropTable: () => database!.getQueryInterface().dropTable(table),
  });

  // initialize a separate schema before loading the production model
  beforeAll(async () => {
    admin = new Sequelize(externalDatabaseUrl!, {
      dialect: "postgres",
      logging: false,
    });
    coordination = await acquirePostgresIntegrationLock(admin);
    await admin.query(`CREATE SCHEMA "${schemaName}"`);
    const url = new URL(externalDatabaseUrl!);
    url.searchParams.set("options", `-c search_path=${schemaName}`);
    scopedUrl = url.toString();
    process.env.DATABASE_URL = scopedUrl;
    ({ db: database } = await import("../../server/lib/db"));
    database.options.define = {
      ...database.options.define,
      schema: schemaName,
    };
    await database.authenticate();
    await migration.up(migrationInterface(), Sequelize);
    const { DatabaseOpenaiCameraStore } =
      await import("../../server/lib/openaiCameraStore");
    first = new DatabaseOpenaiCameraStore();
    second = new DatabaseOpenaiCameraStore();
  }, POSTGRES_INTEGRATION_HOOK_TIMEOUT_MS);

  // independently exercise concurrent first-use insertion in every case
  beforeEach(async () => {
    await database!.getQueryInterface().bulkDelete(table, {});
  });

  // close runtime pools and remove only the isolated integration schema
  afterAll(async () => {
    try {
      // rollback the actual migration before dropping its schema
      if (database) {
        try {
          await migration.down(migrationInterface());
        } finally {
          await database.close();
        }
      }
    } finally {
      try {
        // preserve the caller's other schemas even after setup failure
        if (admin) {
          await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
        }
      } finally {
        // release shared integration coordination before closing its pool
        if (coordination) {
          await coordination.commit();
        }
        await admin?.close();
        // restore the worker's prior environment
        if (originalDatabaseUrl === undefined) {
          delete process.env.DATABASE_URL;
        } else {
          process.env.DATABASE_URL = originalDatabaseUrl;
        }
      }
    }
  });

  // race actual connections against the initially absent singleton row
  it("allows exactly one same-slot claimant and rejects restart replay", async () => {
    const claims = await Promise.all([
      first.beginRound(slot),
      second.beginRound(slot),
    ]);
    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    expect((await second.read()).lastStartedSlot).toBe(slot);
    await expect(second.beginRound(slot)).resolves.toBeNull();
  });

  // persist monotonically regardless of which racing transaction obtains the lock first
  it("rejects an old owner's save after competing newer claims", async () => {
    const old = await first.beginRound(slot);
    expect(old).not.toBeNull();
    // narrow the claimed state without manufacturing replacement evidence
    if (!old) {
      throw new Error("initial round was not claimed");
    }
    await Promise.all([
      first.beginRound(slot + 300_000),
      second.beginRound(slot + 600_000),
    ]);
    expect((await first.read()).lastStartedSlot).toBe(slot + 600_000);
    await expect(first.save(old)).rejects.toThrow();
    expect((await second.read()).lastStartedSlot).toBe(slot + 600_000);
  });

  // read jsonb through a newly authenticated pool rather than an in-memory fake
  it("retains a detached completed snapshot across a new database connection", async () => {
    const claimed = await first.beginRound(slot);
    // require the real durable claim before completing its snapshot
    if (!claimed) {
      throw new Error("initial round was not claimed");
    }
    claimed.lastCompletedAt = slot + 1_000;
    await first.save(claimed);
    const reconnected = new Sequelize(scopedUrl, {
      dialect: "postgres",
      logging: false,
    });
    try {
      const rows = await reconnected.query<{
        state: OpenaiCameraPipelineState;
      }>(
        `SELECT "state" FROM "${schemaName}"."OpenaiCameraPipelineStates" WHERE "key" = 'default'`,
        { type: QueryTypes.SELECT }
      );
      expect(rows).toEqual([{ state: claimed }]);
      claimed.lastCompletedAt = slot + 2_000;
      expect((await second.read()).lastCompletedAt).toBe(slot + 1_000);
    } finally {
      await reconnected.close();
    }
  });

  // execute real rollback and recreation without touching any other schema
  it("rolls the migration down and up reversibly", async () => {
    await migration.down(migrationInterface());
    const rows = await database!.query<{ name: string | null }>(
      `SELECT to_regclass('"${schemaName}"."OpenaiCameraPipelineStates"')::text AS "name"`,
      { type: QueryTypes.SELECT }
    );
    expect(rows).toEqual([{ name: null }]);
    await migration.up(migrationInterface(), Sequelize);
    await expect(first.beginRound(slot)).resolves.toMatchObject({
      lastStartedSlot: slot,
    });
  });
});
