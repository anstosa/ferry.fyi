import { randomUUID } from "node:crypto";

import { Sequelize } from "sequelize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import capacityMigration from "../../server/migrations/20261003000100-create-capacity-observations.js";
import usageMigration from "../../server/migrations/20261003000200-create-google-routes-usage-months.js";
import autocompleteMigration from "../../server/migrations/20261003000300-allow-autocomplete-usage.js";
const url = process.env.BOAT_TEST_DATABASE_URL;

// rehearse only in the explicitly isolated local boat-test database
const enabled = Boolean(
  url &&
  /^postgres:\/\/boat_test:boat_test@127\.0\.0\.1:16632\/boat_test$/u.test(url)
);

describe.runIf(enabled)("boat evidence postgres rehearsal", () => {
  const database = new Sequelize(
    url ?? "postgres://boat_test:boat_test@127.0.0.1:16632/boat_test",
    { logging: false }
  );
  const query = database.getQueryInterface();
  // apply the new schemas and autocomplete constraint in a disposable database
  beforeAll(async () => {
    await database.authenticate();
    await capacityMigration.up(query, Sequelize);
    await usageMigration.up(query, Sequelize);
    await autocompleteMigration.up(query);
  });
  // exercise rollback without touching application data
  afterAll(async () => {
    await usageMigration.down(query);
    await capacityMigration.down(query);
    await database.close();
  });

  // exercise the new sku and a non-destructive rollback against real postgres
  it("accepts autocomplete aggregates and refuses rollback while they remain", async () => {
    await database.query(
      `INSERT INTO "GoogleRoutesUsageMonths" ("month", "sku", "createdAt", "updatedAt") VALUES ('2026-09', 'autocomplete_requests', NOW(), NOW())`
    );
    await expect(autocompleteMigration.down(query)).rejects.toThrow();
    const [rows] = await database.query(
      `SELECT "sku" FROM "GoogleRoutesUsageMonths" WHERE "month" = '2026-09'`
    );
    expect(rows).toEqual([{ sku: "autocomplete_requests" }]);
    // clear only this isolated test row before proving a successful rollback
    await database.query(
      `DELETE FROM "GoogleRoutesUsageMonths" WHERE "month" = '2026-09'`
    );
    await autocompleteMigration.down(query);
    await autocompleteMigration.up(query);
  });

  // enforce source identity and immutability using the real postgres guards
  it("preserves distinct polls, deduplicates retries and rejects update/derived labels", async () => {
    const pollId = randomUUID();
    const allocationGroupId = randomUUID();
    const row = {
      pollId,
      allocationGroupId,
      departureId: "14",
      arrivalId: "5",
      departureTime: 1800002400,
      receivedAt: 1800000000,
      driveUpSpaces: 10,
      reservableSpaces: null,
      driveUpDisplayed: true,
      reservableDisplayed: false,
      maxSpaceCount: 100,
      isCancelled: false,
      vesselId: "1",
      reportingStateAtReceipt: "active",
      sourceKind: "wsf-direct",
      usableForFillLabel: true,
      modelInputSchemaVersion: "capacity-input-v1",
    };
    await query.bulkInsert("CapacityObservations", [row]);
    await query.bulkInsert("CapacityObservations", [row], {
      ignoreDuplicates: true,
    });
    await query.bulkInsert("CapacityObservations", [
      { ...row, pollId: randomUUID() },
    ]);
    const [counts] = await database.query(
      'SELECT count(*)::int AS count FROM "CapacityObservations"'
    );
    expect(counts).toEqual([{ count: 2 }]);
    await expect(
      database.query('UPDATE "CapacityObservations" SET "driveUpSpaces"=0')
    ).rejects.toThrow(/immutable/);
    await expect(
      query.bulkInsert("CapacityObservations", [
        {
          ...row,
          pollId: randomUUID(),
          allocationGroupId: null,
          triggerPollId: pollId,
          sourceKind: "repair-derived",
          repairReason: "delayed-predecessor-missing",
        },
      ])
    ).rejects.toThrow();
    await expect(
      query.bulkInsert("CapacityObservations", [
        { ...row, pollId: randomUUID(), driveUpSpaces: -1 },
      ])
    ).rejects.toThrow();
  });

  // prove multi-arrival physical rows disappear together on a failed transaction
  it("rolls back a whole allocation group instead of leaving partial arrival rows", async () => {
    const pollId = randomUUID();
    const allocationGroupId = randomUUID();
    await expect(
      database.transaction(async (transaction) => {
        await database.query(
          `INSERT INTO "CapacityObservations" ("pollId","allocationGroupId","departureId","arrivalId","departureTime","receivedAt","driveUpDisplayed","reservableDisplayed","isCancelled","reportingStateAtReceipt","sourceKind","usableForFillLabel","modelInputSchemaVersion") VALUES (:pollId,:allocationGroupId,'1','10',1800002400,1800000000,true,false,false,'active','wsf-direct',false,'capacity-input-v1'),(:pollId,:allocationGroupId,'1','13',1800002400,1800000000,true,false,false,'active','wsf-direct',false,'capacity-input-v1')`,
          { replacements: { pollId, allocationGroupId }, transaction }
        );
        throw new Error("synthetic crossing-write failure");
      })
    ).rejects.toThrow("synthetic crossing-write failure");
    const [rows] = await database.query(
      'SELECT "id" FROM "CapacityObservations" WHERE "pollId"=:pollId',
      { replacements: { pollId } }
    );
    expect(rows).toHaveLength(0);
  });

  // validate concurrent billing updates against durable counters and row locks
  it("keeps parallel attempts and completions atomic across month rollover", async () => {
    const { createGoogleRoutesUsageStore } =
      await import("../../server/lib/googleRoutesUsage");
    const { GoogleRoutesUsageMonth } =
      await import("../../server/models/GoogleRoutesUsageMonth");
    const { db } = await import("../../server/lib/db");
    GoogleRoutesUsageMonth.init(GoogleRoutesUsageMonth.getAttributes(), {
      sequelize: database,
      tableName: "GoogleRoutesUsageMonths",
      modelName: "GoogleRoutesUsageMonth",
      timestamps: true,
    });
    const events: unknown[] = [];
    const store = createGoogleRoutesUsageStore({
      model: GoogleRoutesUsageMonth,
      emitAlert: (event) => {
        events.push(event);
      },
    });
    const at = new Date("2026-11-01T06:59:59Z");
    await GoogleRoutesUsageMonth.create({
      month: "2026-10",
      sku: "compute_routes_pro",
      attemptCount: 3999,
      successCount: 3999,
      knownFailureCount: 0,
    });
    const handles = await Promise.all(
      Array.from({ length: 20 }, () => store.open("compute_routes_pro", at))
    );
    await Promise.all(
      handles.map((handle, index) =>
        store.complete(handle, index % 2 === 0 ? "success" : "known-failure")
      )
    );
    const rows = await store.list("2026-10");
    expect(rows[0]).toMatchObject({
      attemptCount: 4019,
      successCount: 4009,
      knownFailureCount: 10,
      unresolvedCount: 0,
    });
    expect(events).toHaveLength(1);
    expect(await store.list("2026-11")).toHaveLength(0);
    await db.close();
  });
});
