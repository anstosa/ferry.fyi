import { createRequire } from "node:module";

import { QueryTypes, Sequelize, type Transaction } from "sequelize";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  AutomaticCheckinCandidateV1,
  AutomaticTerminalCheckinCandidateV1,
} from "../../shared/contracts/leaderboards";
import TERMINAL_DATA_OVERRIDES from "../../shared/data/terminals.json";
import {
  automaticTerminalRegionContentHashV1,
  canonicalAutomaticTerminalRegionBytesV1,
} from "../../shared/lib/leaderboardAutomaticContracts";
import { acquirePostgresIntegrationLock } from "./helpers/postgresIntegrationLock";

// preserve server helpers under the mixed client/server alias
vi.mock("~/lib/leaderboards", () => import("../../server/lib/leaderboards"));

const require = createRequire(import.meta.url);
const createLeaderboards = require("../../server/migrations/20260723000100-create-leaderboards.js");
const addVerboseNotifications = require("../../server/migrations/20260723000200-add-verbose-leaderboard-notifications.js");
const addSailingId = require("../../server/migrations/20260723000300-add-leaderboard-vessel-sailing-id.js");
const addAutomaticPreference = require("../../server/migrations/20260724000100-add-automatic-leaderboard-checkins.js");
const createFeatureFlags = require("../../server/migrations/20260724000200-create-feature-flags.js");
const createAutomaticFlag = require("../../server/migrations/20260724000300-add-automatic-checkins-feature-flag.js");
const addFeatureControls = require("../../server/migrations/20260724000400-add-feature-flag-controls.js");
const createAutomaticConfigs = require("../../server/migrations/20260817000100-create-leaderboard-automatic-terminal-configs.js");
const createEnrollments = require("../../server/migrations/20260817000200-create-leaderboard-automatic-enrollments.js");
const createReceipts = require("../../server/migrations/20260817000300-create-leaderboard-automatic-candidate-receipts.js");
const addLastObservedAt = require("../../server/migrations/20260817000400-add-last-observed-at-to-leaderboard-terminal-presences.js");
const addPolicyGeneration = require("../../server/migrations/20260817000600-add-server-policy-generation-to-feature-flags.js");
const addExpiryObservedAt = require("../../server/migrations/20260817000700-add-expiry-observed-at-to-leaderboard-automatic-enrollments.js");
const restrictEnrollmentDeletion = require("../../server/migrations/20260817000800-restrict-automatic-receipt-enrollment-deletion.js");
const storeFinalPolicyGeneration = require("../../server/migrations/20260817000900-store-final-policy-generation-on-automatic-receipts.js");
const createSupporterBilling = require("../../server/migrations/20260823000100-create-supporter-billing.js");

const externalDatabaseUrl =
  process.env.LEADERBOARD_TERMINAL_AUTOMATIC_ORDERING_TEST_DATABASE_URL;
// gate real database coverage explicitly
const describePostgres = externalDatabaseUrl ? describe : describe.skip;

const subject = "auth0|terminal-ordering-postgres";
const enrollmentId = "323e4567-e89b-42d3-a456-426614174000";
const secondEnrollmentId = "423e4567-e89b-42d3-a456-426614174001";
const pepper = "terminal-ordering-postgres-pepper";
const terminalId = "7";
const secondTerminalId = "8";
const configGeneration = 1;
const cooldownMs = 40 * 60_000;

interface DeferredGate {
  reached: Promise<void>;
  release: () => void;
  wait: () => Promise<void>;
}

interface ManualEventResult {
  credited?: boolean;
  reason?: string;
  recorded?: boolean;
}

interface MigrationShapeRow {
  exitedAt: Date | null;
  lastCreditedAt: Date | null;
  lastObservedAt: Date | null;
  subject: string;
}

// build a deterministic transaction barrier
const deferredGate = (): DeferredGate => {
  let reach!: () => void;
  let release!: () => void;
  // capture barrier arrival
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  // capture barrier release
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    reached,
    release,
    // announce the held lock before waiting
    wait: async () => {
      reach();
      await released;
    },
  };
};

// build a strict unique candidate id
let candidateSequence = 0;
const nextCandidateId = (): string =>
  `${String(++candidateSequence).padStart(21, "A")}A`;

// build one strict terminal candidate
const terminalCandidate = (
  capturedAtMs: number,
  overrides: Partial<AutomaticTerminalCheckinCandidateV1> = {}
): AutomaticTerminalCheckinCandidateV1 => ({
  accuracyMillimeters: 10_000,
  candidateId: nextCandidateId(),
  capturedAtMs,
  configGeneration,
  kind: "terminal",
  latitudeE7: 476_000_000,
  longitudeE7: -1_224_000_000,
  schemaVersion: 1,
  terminalId,
  ...overrides,
});

// build one non-crediting vessel candidate
const vesselCandidate = (
  capturedAtMs: number
): AutomaticCheckinCandidateV1 => ({
  accuracyMillimeters: 10_000,
  candidateId: nextCandidateId(),
  capturedAtMs,
  kind: "vessel",
  latitudeE7: 476_000_000,
  longitudeE7: -1_224_000_000,
  sailingId: "vessel-1:1:7:8",
  schemaVersion: 1,
  vesselId: "vessel-1",
});

// cover real shared chronology and policy serialization
describePostgres("terminal automatic ordering Postgres integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const schemaName = `leaderboard_terminal_ordering_${process.pid}_${Date.now()}`;
  let admin: Sequelize;
  let coordination: Transaction;
  let database: Sequelize;
  let migrationRows: MigrationShapeRow[];
  let LeaderboardCheckin: typeof import("../../server/models/LeaderboardCheckin").LeaderboardCheckin;
  let LeaderboardTerminalPresence: typeof import("../../server/models/LeaderboardTerminalPresence").LeaderboardTerminalPresence;
  let Route: typeof import("../../server/models/Route").Route;
  let advanceServerPolicyGeneration: typeof import("../../server/lib/leaderboardAutomaticPolicy").advanceServerPolicyGeneration;
  let evaluateTerminalEligibility: typeof import("../../server/lib/leaderboards").evaluateTerminalEligibility;
  let lockLeaderboardAutomaticPolicy: typeof import("../../server/lib/leaderboardAutomaticPolicy").lockLeaderboardAutomaticPolicy;
  let withLeaderboardAutomaticPolicyTransaction: typeof import("../../server/lib/leaderboardAutomaticPolicy").withLeaderboardAutomaticPolicyTransaction;
  let createCandidateHandler: typeof import("../../server/services/leaderboardAutomaticCandidateReceipts").createLeaderboardAutomaticCandidateHandler;
  let createTerminalEvaluator: typeof import("../../server/services/leaderboardAutomaticTerminalProof").createLeaderboardAutomaticTerminalProofEvaluator;
  let anonymizeLeaderboardAccount: typeof import("../../server/lib/leaderboardPrivacy").anonymizeLeaderboardAccount;

  // scope migration calls to the isolated schema
  const scopedQueryInterface = () => {
    const queryInterface = database.getQueryInterface();
    // qualify every migration-owned table
    const table = (tableName: string) => ({ schema: schemaName, tableName });
    return {
      ...queryInterface,
      sequelize: queryInterface.sequelize,
      // scope added columns
      addColumn: (tableName: string, ...args: unknown[]) =>
        queryInterface.addColumn(
          table(tableName),
          ...(args as [string, object, object?])
        ),
      // scope foreign keys
      addConstraint: (tableName: string, ...args: unknown[]) =>
        queryInterface.addConstraint(table(tableName), ...(args as [object])),
      // scope indexes
      addIndex: (tableName: string, ...args: unknown[]) =>
        queryInterface.addIndex(
          table(tableName),
          ...(args as [string[], object])
        ),
      // scope seeded rows
      bulkInsert: (tableName: string, ...args: unknown[]) =>
        queryInterface.bulkInsert(table(tableName), ...(args as [object[]])),
      // scope created tables
      createTable: (tableName: string, ...args: unknown[]) =>
        queryInterface.createTable(table(tableName), ...(args as [object])),
      // scope removed constraints
      removeConstraint: (tableName: string, ...args: unknown[]) =>
        queryInterface.removeConstraint(
          table(tableName),
          ...(args as [string, object])
        ),
    };
  };

  // create one isolated migrated schema and runtime composition
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
    const queryInterface = scopedQueryInterface();
    await createLeaderboards.up(queryInterface, Sequelize);
    await addVerboseNotifications.up(queryInterface, Sequelize);
    await addSailingId.up(queryInterface, Sequelize);
    await addAutomaticPreference.up(queryInterface, Sequelize);

    const migrationBase = new Date("2026-08-18T01:00:00.000Z");
    const credit = new Date(migrationBase.getTime() + 1_000);
    const exit = new Date(migrationBase.getTime() + 2_000);
    const equal = new Date(migrationBase.getTime() + 3_000);
    const shapes = [
      ["both-null", null, null],
      ["credit-only", credit, null],
      ["exit-only", null, exit],
      ["credit-before-exit", credit, exit],
      ["credit-equal-exit", equal, equal],
      ["credit-after-exit", exit, credit],
    ] as const;
    // seed every populated upgrade shape before chronology migration
    for (const [shapeSubject, lastCreditedAt, exitedAt] of shapes) {
      await database.query(
        `INSERT INTO "LeaderboardTerminalPresences" (
          "subject", "terminalId", "lastCreditedAt", "exitedAt",
          "createdAt", "updatedAt"
        ) VALUES (
          :shapeSubject, '7', :lastCreditedAt, :exitedAt,
          :migrationBase, :migrationBase
        )`,
        {
          replacements: {
            exitedAt,
            lastCreditedAt,
            migrationBase,
            shapeSubject,
          },
        }
      );
    }
    await addLastObservedAt.up(queryInterface, Sequelize);
    migrationRows = await database.query<MigrationShapeRow>(
      `SELECT "subject", "lastCreditedAt", "exitedAt", "lastObservedAt"
       FROM "LeaderboardTerminalPresences" ORDER BY "subject"`,
      { type: QueryTypes.SELECT }
    );
    await createFeatureFlags.up(queryInterface, Sequelize);
    await createAutomaticFlag.up(queryInterface, Sequelize);
    await addFeatureControls.up(queryInterface, Sequelize);
    await createAutomaticConfigs.up(queryInterface, Sequelize);
    await createEnrollments.up(queryInterface, Sequelize);
    await createReceipts.up(queryInterface, Sequelize);
    await addPolicyGeneration.up(queryInterface, Sequelize);
    await addExpiryObservedAt.up(queryInterface, Sequelize);
    await restrictEnrollmentDeletion.up(queryInterface, Sequelize);
    await storeFinalPolicyGeneration.up(queryInterface, Sequelize);
    // keep isolated profile schema current
    await createSupporterBilling.up(queryInterface, Sequelize);

    const checkinModule =
      await import("../../server/models/LeaderboardCheckin");
    const presenceModule =
      await import("../../server/models/LeaderboardTerminalPresence");
    const routeModule = await import("../../server/models/Route");
    const policyModule =
      await import("../../server/lib/leaderboardAutomaticPolicy");
    const leaderboardsModule = await import("../../server/lib/leaderboards");
    const receiptModule =
      await import("../../server/services/leaderboardAutomaticCandidateReceipts");
    const terminalProofModule =
      await import("../../server/services/leaderboardAutomaticTerminalProof");
    const privacyModule = await import("../../server/lib/leaderboardPrivacy");
    ({ LeaderboardCheckin } = checkinModule);
    ({ LeaderboardTerminalPresence } = presenceModule);
    ({ Route } = routeModule);
    ({
      advanceServerPolicyGeneration,
      lockLeaderboardAutomaticPolicy,
      withLeaderboardAutomaticPolicyTransaction,
    } = policyModule);
    ({ evaluateTerminalEligibility } = leaderboardsModule);
    ({ createLeaderboardAutomaticCandidateHandler: createCandidateHandler } =
      receiptModule);
    ({
      createLeaderboardAutomaticTerminalProofEvaluator: createTerminalEvaluator,
    } = terminalProofModule);
    ({ anonymizeLeaderboardAccount } = privacyModule);

    Route.purge();
    Route.getOrCreate("ordering-route", {
      crossingTime: 20,
      id: "ordering-route",
      terminalIds: [terminalId, secondTerminalId],
    });
  });

  // remove only the isolated integration schema
  afterAll(async () => {
    Route?.purge();
    // close the scoped runtime pool
    if (database) {
      await database.close();
    }
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);

    // restore a missing original value
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
    await coordination.commit();
    await admin.close();
  });

  // seed one complete automatic policy and immutable generation
  const seedOperationalState = async (): Promise<void> => {
    await database.query(
      `TRUNCATE TABLE
        "LeaderboardAutomaticCandidateReceipts",
        "LeaderboardAutomaticEnrollments",
        "LeaderboardAutomaticTerminalConfigs",
        "LeaderboardCheckins",
        "LeaderboardTerminalPresences",
        "LeaderboardProfiles",
        "FeatureFlagAllowlists",
        "FeatureFlags"
       RESTART IDENTITY CASCADE`
    );
    const now = new Date();
    await database.query(
      `INSERT INTO "FeatureFlags" (
        "name", "enabled", "killSwitch", "serverPolicyGeneration",
        "createdAt", "updatedAt"
      ) VALUES
        ('leaderboards', true, false, 0, :now, :now),
        ('automaticLeaderboardCheckins', true, false, 0, :now, :now)`,
      { replacements: { now } }
    );
    await database.query(
      `INSERT INTO "LeaderboardProfiles" (
        "subject", "displayName", "useFullName", "notificationsEnabled",
        "optedOut", "verboseNotificationsEnabled", "automaticCheckinsEnabled",
        "createdAt", "updatedAt"
      ) VALUES (
        :subject, '', false, true, false, false, true, :now, :now
      )`,
      { replacements: { now, subject } }
    );
    await database.query(
      `INSERT INTO "LeaderboardAutomaticEnrollments" (
        "enrollmentId", "subject", "platform", "capabilityVersion",
        "installationNonceHash", "currentTokenDigest", "scopes",
        "detectorEnabled", "health", "healthUpdatedAt", "tokenIssuedAt",
        "tokenExpiresAt", "revokedAt", "createdAt", "updatedAt"
      ) VALUES
      (
        :enrollmentId, :subject, 'ios', 1, :nonceHash, :tokenDigest,
        ARRAY[
          'automatic-checkins:config:read',
          'automatic-checkins:status:read',
          'automatic-checkins:candidates:write',
          'automatic-checkins:enrollment:revoke'
        ]::text[], true, 'healthy', :now, :now, :expiresAt,
        null, :now, :now
      ),
      (
        :secondEnrollmentId, :subject, 'android', 1,
        :secondNonceHash, :secondTokenDigest,
        ARRAY[
          'automatic-checkins:config:read',
          'automatic-checkins:status:read',
          'automatic-checkins:candidates:write',
          'automatic-checkins:enrollment:revoke'
        ]::text[], true, 'healthy', :now, :now, :expiresAt,
        null, :now, :now
      )`,
      {
        replacements: {
          enrollmentId,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
          nonceHash: "1".repeat(64),
          now,
          secondEnrollmentId,
          secondNonceHash: "3".repeat(64),
          secondTokenDigest: "4".repeat(64),
          subject,
          tokenDigest: "2".repeat(64),
        },
      }
    );
    const terminalIds = Object.keys(TERMINAL_DATA_OVERRIDES).sort(
      // compare canonical utf-8 identifiers
      (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))
    );
    const regions = terminalIds.map(
      // assign deterministic synthetic integration geometry
      (value, index) => {
        let latitudeE7 = 470_000_000 + index * 10_000;
        let longitudeE7 = -1_220_000_000 - index * 10_000;

        // bind the first test terminal geometry
        if (value === terminalId) {
          latitudeE7 = 476_000_000;
          longitudeE7 = -1_224_000_000;
        } else if (value === secondTerminalId) {
          // bind the independent test terminal geometry
          latitudeE7 = 477_000_000;
          longitudeE7 = -1_225_000_000;
        }

        return {
          configGeneration,
          latitudeE7,
          longitudeE7,
          radiusMillimeters: 304_800,
          terminalId: value,
        };
      }
    );
    const regionJson = Buffer.from(
      canonicalAutomaticTerminalRegionBytesV1(regions)
    ).toString("utf8");
    const contentHash = await automaticTerminalRegionContentHashV1(regions);
    await database.query(
      `INSERT INTO "LeaderboardAutomaticTerminalConfigs" (
        "configGeneration", "schemaVersion", "regionJson", "contentHash",
        "generatedAt", "activatedAt", "retainUntil"
      ) VALUES (
        :configGeneration, 1, :regionJson, :contentHash,
        :activatedAt, :activatedAt, :retainUntil
      )`,
      {
        replacements: {
          activatedAt: new Date(now.getTime() - 24 * 60 * 60_000),
          configGeneration,
          contentHash,
          regionJson,
          retainUntil: new Date(now.getTime() + 24 * 60 * 60_000),
        },
      }
    );
  };

  // reset one isolated policy before each race
  beforeEach(async () => {
    candidateSequence = 0;
    await seedOperationalState();
  });

  // build the complete production candidate path with an optional barrier
  const automaticHandler = (gate?: DeferredGate) => {
    const terminalEvaluator = createTerminalEvaluator();
    return createCandidateHandler({
      candidateKeyPepper: pepper,
      // hold every production proof lock when requested
      proofEvaluator: async (context) => {
        // expose deterministic concurrent ordering
        if (gate) {
          await gate.wait();
        }
        return await terminalEvaluator(context);
      },
    });
  };

  // submit one candidate through receipt and proof composition
  const submitAutomatic = async (
    value: AutomaticCheckinCandidateV1,
    gate?: DeferredGate,
    targetEnrollmentId = enrollmentId
  ) =>
    await automaticHandler(gate)({
      candidate: value,
      enrollmentId: targetEnrollmentId,
      subject,
    });

  // apply the manual controller chronology under production locks
  const submitManual = async (
    kind: "entry" | "exit",
    eventAt: Date,
    gate?: DeferredGate
  ): Promise<ManualEventResult> =>
    await database.transaction(async (transaction) => {
      await lockLeaderboardAutomaticPolicy(transaction, {
        createProfile: true,
        lockPresence: true,
        subject,
        terminalId,
      });
      const [state] = await LeaderboardTerminalPresence.findOrCreate({
        defaults: {
          exitedAt: null,
          lastCreditedAt: null,
          lastObservedAt: null,
          subject,
          terminalId,
        },
        transaction,
        where: { subject, terminalId },
      });
      await state.reload({ lock: transaction.LOCK.UPDATE, transaction });

      // expose deterministic concurrent ordering
      if (gate) {
        await gate.wait();
      }

      // reject chronology rollback and equality
      if (
        state.lastObservedAt &&
        eventAt.getTime() <= state.lastObservedAt.getTime()
      ) {
        return kind === "entry"
          ? { credited: false, reason: "STALE_LOCATION" }
          : { recorded: false, reason: "STALE_LOCATION" };
      }

      // record one verified manual exit
      if (kind === "exit") {
        // require an active entry before exit
        if (!state.lastCreditedAt || state.exitedAt) {
          return { recorded: false };
        }
        await state.update(
          { exitedAt: eventAt, lastObservedAt: eventAt },
          { transaction }
        );
        return { recorded: true };
      }

      const eligibility = evaluateTerminalEligibility(state, eventAt, 20);
      // preserve manual eligibility denials
      if (!eligibility.eligible) {
        return { credited: false, reason: eligibility.reason };
      }
      await LeaderboardCheckin.create(
        {
          entityId: terminalId,
          kind: "terminal",
          occurredAt: eventAt,
          sailingId: null,
          subject,
        },
        { transaction }
      );
      await state.update(
        {
          exitedAt: null,
          lastCreditedAt: eventAt,
          lastObservedAt: eventAt,
        },
        { transaction }
      );
      return { credited: true };
    });

  // seed one exact chronology row
  const setPresence = async (
    lastCreditedAt: Date | null,
    exitedAt: Date | null,
    lastObservedAt: Date | null
  ): Promise<void> => {
    await LeaderboardTerminalPresence.create({
      exitedAt,
      lastCreditedAt,
      lastObservedAt,
      subject,
      terminalId,
    });
  };

  // read the sole test-terminal chronology
  const getPresence = async () =>
    await LeaderboardTerminalPresence.findOne({
      where: { subject, terminalId },
    });

  // prove actual populated migration semantics and restart visibility
  it("backfills every upgrade shape without fabricating migration time", async () => {
    const bySubject = new Map(
      migrationRows.map(
        // index each synthetic upgrade shape
        (row) => [row.subject, row]
      )
    );
    expect(bySubject.get("both-null")?.lastObservedAt).toBeNull();
    // compare every non-null SQL GREATEST result
    for (const row of migrationRows.filter(
      // omit the intentionally null upgrade shape
      (value) => value.subject !== "both-null"
    )) {
      expect(row.lastObservedAt?.getTime()).toBe(
        Math.max(
          row.lastCreditedAt?.getTime() ?? Number.NEGATIVE_INFINITY,
          row.exitedAt?.getTime() ?? Number.NEGATIVE_INFINITY
        )
      );
    }

    const reconnect = new Sequelize(process.env.DATABASE_URL as string, {
      dialect: "postgres",
      logging: false,
    });
    const [columns] = await reconnect.query(
      `SELECT "is_nullable" FROM information_schema.columns
       WHERE table_schema = :schemaName
         AND table_name = 'LeaderboardTerminalPresences'
         AND column_name = 'lastObservedAt'`,
      { replacements: { schemaName } }
    );
    expect(columns).toEqual([{ is_nullable: "YES" }]);
    await reconnect.close();
  });

  // prove full event-time lifecycle, final replay, and unique presence
  it("persists entry, exit, re-entry, and immutable duplicate receipts", async () => {
    const nowMs = Date.now();
    const entryAtMs = nowMs - 60 * 60_000;
    const exitAtMs = entryAtMs + 5 * 60_000;
    const reentryAtMs = entryAtMs + cooldownMs;
    const entry = terminalCandidate(entryAtMs);
    const exit = terminalCandidate(exitAtMs, {
      latitudeE7: 477_000_000,
    });
    const reentry = terminalCandidate(reentryAtMs);

    await expect(submitAutomatic(entry)).resolves.toMatchObject({
      credited: true,
      outcome: "credited",
    });
    await expect(submitAutomatic(exit)).resolves.toMatchObject({
      credited: false,
      outcome: "outside_terminal",
    });
    const final = await submitAutomatic(reentry);
    expect(final).toMatchObject({ credited: true, outcome: "credited" });
    await expect(submitAutomatic(reentry)).resolves.toEqual(final);

    const state = await getPresence();
    expect(state?.lastCreditedAt?.getTime()).toBe(reentryAtMs);
    expect(state?.lastObservedAt?.getTime()).toBe(reentryAtMs);
    expect(state?.exitedAt).toBeNull();
    const checkinTimes = await database.query<{ occurredAt: Date }>(
      `SELECT "occurredAt" FROM "LeaderboardCheckins"
       WHERE "subject" = :subject ORDER BY "occurredAt"`,
      { replacements: { subject }, type: QueryTypes.SELECT }
    );
    expect(
      checkinTimes.map(
        // compare exact stored event clocks
        ({ occurredAt }) => occurredAt.getTime()
      )
    ).toEqual([entryAtMs, reentryAtMs]);
    const counts = await database.query<{ count: string }>(
      `SELECT count(*) AS "count" FROM "LeaderboardAutomaticCandidateReceipts"`,
      { type: QueryTypes.SELECT }
    );
    expect(counts[0].count).toBe("3");
    await expect(
      database.query(
        `UPDATE "LeaderboardAutomaticTerminalConfigs"
         SET "contentHash" = :contentHash
         WHERE "configGeneration" = :configGeneration`,
        {
          replacements: {
            configGeneration,
            contentHash: "f".repeat(64),
          },
        }
      )
    ).rejects.toThrow("immutable");
    await expect(
      LeaderboardTerminalPresence.create({
        exitedAt: null,
        lastCreditedAt: null,
        lastObservedAt: null,
        subject,
        terminalId,
      })
    ).rejects.toThrow();
  });

  // prove duplicate serialization and retryable receipt completion
  it("converges concurrent duplicates and one retryable receipt to final", async () => {
    const concurrent = terminalCandidate(Date.now() - 60_000);
    const [first, duplicate] = await Promise.all([
      submitAutomatic(concurrent),
      submitAutomatic(concurrent),
    ]);
    expect(duplicate).toEqual(first);
    expect(first.outcome).toBe("credited");
    const duplicateCounts = await database.query<{
      checkins: string;
      receipts: string;
    }>(
      `SELECT
        (SELECT count(*) FROM "LeaderboardCheckins") AS "checkins",
        (SELECT count(*) FROM "LeaderboardAutomaticCandidateReceipts") AS "receipts"`,
      { type: QueryTypes.SELECT }
    );
    expect(duplicateCounts[0]).toEqual({ checkins: "1", receipts: "1" });

    await seedOperationalState();
    Route.purge();
    const retryable = terminalCandidate(Date.now() - 60_000);
    await expect(submitAutomatic(retryable)).resolves.toMatchObject({
      disposition: "retryable",
      outcome: "temporarily_unavailable",
    });
    Route.getOrCreate("ordering-route", {
      crossingTime: 20,
      id: "ordering-route",
      terminalIds: [terminalId, secondTerminalId],
    });
    await expect(submitAutomatic(retryable)).resolves.toMatchObject({
      disposition: "final",
      outcome: "credited",
    });
    const retryRows = await database.query<{
      attemptCount: number;
      state: string;
    }>(
      `SELECT "attemptCount", "state"
       FROM "LeaderboardAutomaticCandidateReceipts"`,
      { type: QueryTypes.SELECT }
    );
    expect(retryRows).toEqual([{ attemptCount: 2, state: "final_credited" }]);
  });

  // prove stale cross-device delivery and exact cooldown equality
  it("never rolls two-device chronology backward and admits the exact cooldown edge", async () => {
    const nowMs = Date.now();
    const newerAtMs = nowMs - 5 * 60_000;
    await expect(
      submitAutomatic(
        terminalCandidate(newerAtMs),
        undefined,
        secondEnrollmentId
      )
    ).resolves.toMatchObject({ outcome: "credited" });
    await expect(
      submitAutomatic(
        terminalCandidate(newerAtMs - 1, { latitudeE7: 477_000_000 }),
        undefined,
        enrollmentId
      )
    ).resolves.toMatchObject({ outcome: "stale_event" });
    expect((await getPresence())?.lastObservedAt?.getTime()).toBe(newerAtMs);
    const deviceReceipts = await database.query<{
      enrollmentId: string;
      state: string;
    }>(
      `SELECT "enrollmentId", "state"
       FROM "LeaderboardAutomaticCandidateReceipts"
       ORDER BY "enrollmentId"`,
      { type: QueryTypes.SELECT }
    );
    expect(deviceReceipts).toEqual([
      { enrollmentId, state: "final_rejected" },
      { enrollmentId: secondEnrollmentId, state: "final_credited" },
    ]);

    await seedOperationalState();
    const creditedAtMs = Date.now() - 60 * 60_000;
    const exitedAtMs = creditedAtMs + 1;
    await setPresence(
      new Date(creditedAtMs),
      new Date(exitedAtMs),
      new Date(exitedAtMs)
    );
    await expect(
      submitAutomatic(terminalCandidate(creditedAtMs + cooldownMs - 1))
    ).resolves.toMatchObject({ outcome: "stale_event" });
    await expect(
      submitAutomatic(terminalCandidate(creditedAtMs + cooldownMs))
    ).resolves.toMatchObject({ outcome: "credited" });
  });

  // prove independent terminals do not share event chronology or receipt fields
  it("keeps terminal and entity work independent without sensitive receipt fields", async () => {
    const nowMs = Date.now() - 60_000;
    const second = terminalCandidate(nowMs, {
      latitudeE7: 477_000_000,
      longitudeE7: -1_225_000_000,
      terminalId: secondTerminalId,
    });
    const [firstResult, secondResult, vesselResult] = await Promise.all([
      submitAutomatic(terminalCandidate(nowMs)),
      submitAutomatic(second),
      submitAutomatic(vesselCandidate(nowMs)),
    ]);
    expect(firstResult.outcome).toBe("credited");
    expect(secondResult.outcome).toBe("credited");
    expect(vesselResult.outcome).toBe("history_unavailable");
    const presences = await LeaderboardTerminalPresence.findAll({
      order: [["terminalId", "ASC"]],
      where: { subject },
    });
    expect(
      presences.map(
        // project independent presence identifiers
        (value) => value.terminalId
      )
    ).toEqual([terminalId, secondTerminalId]);
    const receiptColumns = await database.query<{ columnName: string }>(
      `SELECT column_name AS "columnName" FROM information_schema.columns
       WHERE table_schema = :schemaName
         AND table_name = 'LeaderboardAutomaticCandidateReceipts'`,
      { replacements: { schemaName }, type: QueryTypes.SELECT }
    );
    expect(
      receiptColumns.map(
        // project the privacy-minimal receipt schema
        ({ columnName }) => columnName
      )
    ).not.toEqual(
      expect.arrayContaining([
        "candidateId",
        "capturedAtMs",
        "terminalId",
        "latitudeE7",
        "longitudeE7",
      ])
    );
  });

  // prove manual exit and automatic entry serialize in both lock orders
  it.each(["manual-first", "automatic-first"] as const)(
    "serializes manual exit and automatic entry with %s locks",
    async (order) => {
      const nowMs = Date.now();
      const creditedAt = new Date(nowMs - 60 * 60_000);
      const exitAt = new Date(nowMs - 10 * 60_000);
      const entryAtMs = nowMs - 5 * 60_000;
      await setPresence(creditedAt, null, creditedAt);
      const gate = deferredGate();
      let manual: Promise<ManualEventResult>;
      let automatic: ReturnType<typeof submitAutomatic>;

      // start only the selected lock winner before its peer
      if (order === "manual-first") {
        manual = submitManual("exit", exitAt, gate);
        await gate.reached;
        automatic = submitAutomatic(terminalCandidate(entryAtMs));
      } else {
        automatic = submitAutomatic(terminalCandidate(entryAtMs), gate);
        await gate.reached;
        manual = submitManual("exit", exitAt);
      }
      gate.release();
      const [manualResult, automaticResult] = await Promise.all([
        manual,
        automatic,
      ]);

      expect(manualResult).toEqual({ recorded: true });
      expect(automaticResult.outcome).toBe(
        order === "manual-first" ? "credited" : "stale_event"
      );
      const state = await getPresence();
      expect(state?.lastObservedAt?.getTime()).toBe(
        order === "manual-first" ? entryAtMs : exitAt.getTime()
      );
    }
  );

  // prove automatic exit and manual entry serialize in both lock orders
  it.each(["automatic-first", "manual-first"] as const)(
    "serializes automatic exit and manual entry with %s locks",
    async (order) => {
      const nowMs = Date.now();
      const creditedAt = new Date(nowMs - 60 * 60_000);
      const exitAtMs = nowMs - 10 * 60_000;
      const entryAt = new Date(nowMs - 5 * 60_000);
      await setPresence(creditedAt, null, creditedAt);
      const gate = deferredGate();
      const exit = terminalCandidate(exitAtMs, {
        latitudeE7: 477_000_000,
      });
      let automatic: ReturnType<typeof submitAutomatic>;
      let manual: Promise<ManualEventResult>;

      // start only the selected lock winner before its peer
      if (order === "automatic-first") {
        automatic = submitAutomatic(exit, gate);
        await gate.reached;
        manual = submitManual("entry", entryAt);
      } else {
        manual = submitManual("entry", entryAt, gate);
        await gate.reached;
        automatic = submitAutomatic(exit);
      }
      gate.release();
      const [automaticResult, manualResult] = await Promise.all([
        automatic,
        manual,
      ]);

      expect(automaticResult.outcome).toBe("outside_terminal");
      expect(manualResult).toEqual(
        order === "automatic-first"
          ? { credited: true }
          : { credited: false, reason: "MUST_LEAVE_TERMINAL" }
      );
      expect((await getPresence())?.lastObservedAt?.getTime()).toBe(
        order === "automatic-first" ? entryAt.getTime() : exitAtMs
      );
    }
  );

  // prove manual entry and automatic exit serialize in both lock orders
  it.each(["manual-first", "automatic-first"] as const)(
    "serializes manual entry and automatic exit with %s locks",
    async (order) => {
      const nowMs = Date.now();
      const entryAt = new Date(nowMs - 10 * 60_000);
      const exitAtMs = nowMs - 5 * 60_000;
      const gate = deferredGate();
      const exit = terminalCandidate(exitAtMs, {
        latitudeE7: 477_000_000,
      });
      let automatic: ReturnType<typeof submitAutomatic>;
      let manual: Promise<ManualEventResult>;

      // start only the selected lock winner before its peer
      if (order === "manual-first") {
        manual = submitManual("entry", entryAt, gate);
        await gate.reached;
        automatic = submitAutomatic(exit);
      } else {
        automatic = submitAutomatic(exit, gate);
        await gate.reached;
        manual = submitManual("entry", entryAt);
      }
      gate.release();
      const [manualResult, automaticResult] = await Promise.all([
        manual,
        automatic,
      ]);

      expect(automaticResult.outcome).toBe("outside_terminal");
      expect(manualResult).toEqual(
        order === "manual-first"
          ? { credited: true }
          : { credited: false, reason: "STALE_LOCATION" }
      );
      expect((await getPresence())?.lastObservedAt?.getTime()).toBe(exitAtMs);
      const checkins = await database.query<{ count: string }>(
        `SELECT count(*) AS "count" FROM "LeaderboardCheckins"`,
        { type: QueryTypes.SELECT }
      );
      expect(checkins[0].count).toBe(order === "manual-first" ? "1" : "0");
    }
  );

  // prove equal concurrent entry cannot double credit
  it.each(["manual-first", "automatic-first"] as const)(
    "credits one equal-time manual or automatic entry with %s locks",
    async (order) => {
      const eventAt = new Date(Date.now() - 5 * 60_000);
      const gate = deferredGate();
      const entry = terminalCandidate(eventAt.getTime());
      let automatic: ReturnType<typeof submitAutomatic>;
      let manual: Promise<ManualEventResult>;

      // start only the selected lock winner before its peer
      if (order === "manual-first") {
        manual = submitManual("entry", eventAt, gate);
        await gate.reached;
        automatic = submitAutomatic(entry);
      } else {
        automatic = submitAutomatic(entry, gate);
        await gate.reached;
        manual = submitManual("entry", eventAt);
      }
      gate.release();
      const [manualResult, automaticResult] = await Promise.all([
        manual,
        automatic,
      ]);

      expect(manualResult.credited === true || automaticResult.credited).toBe(
        true
      );
      const checkins = await database.query<{ count: string }>(
        `SELECT count(*) AS "count" FROM "LeaderboardCheckins"`,
        { type: QueryTypes.SELECT }
      );
      expect(checkins[0].count).toBe("1");
    }
  );

  // prove kill and opt-out commits bound candidate credit on either side
  it.each([
    ["kill", "candidate-first"],
    ["kill", "policy-first"],
    ["opt-out", "candidate-first"],
    ["opt-out", "policy-first"],
  ] as const)(
    "%s with %s ordering has no post-commit credit",
    async (mutation, order) => {
      const gate = deferredGate();
      const value = terminalCandidate(Date.now() - 60_000);

      // apply one policy mutation while holding the canonical locks
      const mutatePolicy = async () =>
        await withLeaderboardAutomaticPolicyTransaction(
          { createProfile: false, subject },
          async (policy) => {
            // apply the selected committed policy denial
            if (mutation === "kill") {
              await policy.automaticFlag.update(
                { killSwitch: true },
                { transaction: policy.transaction }
              );
            } else {
              await policy.profile?.update(
                { automaticCheckinsEnabled: false, optedOut: true },
                { transaction: policy.transaction }
              );
            }
            await advanceServerPolicyGeneration(policy);
            // hold the mutation before commit only when it wins
            if (order === "policy-first") {
              await gate.wait();
            }
          }
        );

      let candidatePromise: ReturnType<typeof submitAutomatic>;
      let mutationPromise: ReturnType<typeof mutatePolicy>;

      // start only the selected lock winner before its peer
      if (order === "candidate-first") {
        candidatePromise = submitAutomatic(value, gate);
        await gate.reached;
        mutationPromise = mutatePolicy();
      } else {
        mutationPromise = mutatePolicy();
        await gate.reached;
        candidatePromise = submitAutomatic(value);
      }
      gate.release();
      const [candidateResult] = await Promise.all([
        candidatePromise,
        mutationPromise,
      ]);
      expect(candidateResult.outcome).toBe(
        order === "candidate-first" ? "credited" : "policy_disabled"
      );
      const checkins = await database.query<{ count: string }>(
        `SELECT count(*) AS "count" FROM "LeaderboardCheckins"`,
        { type: QueryTypes.SELECT }
      );
      expect(checkins[0].count).toBe(order === "candidate-first" ? "1" : "0");
    }
  );

  // prove identity deletion linearizes on either side of candidate credit
  it.each(["candidate-first", "deletion-first"] as const)(
    "linearizes account anonymization with %s locks",
    async (order) => {
      const gate = deferredGate();
      const value = terminalCandidate(Date.now() - 60_000);

      // hold the complete deletion boundary before mutation and commit
      const deleteAccount = async () =>
        await withLeaderboardAutomaticPolicyTransaction(
          {
            lockCheckins: true,
            lockPresence: true,
            lockReceipts: true,
            subject,
          },
          async (policy) => {
            await gate.wait();
            return await anonymizeLeaderboardAccount(
              subject,
              policy.transaction,
              policy
            );
          }
        );

      let candidatePromise: ReturnType<typeof submitAutomatic>;
      let deletionPromise: ReturnType<typeof deleteAccount>;

      // start only the selected lock winner before its peer
      if (order === "candidate-first") {
        candidatePromise = submitAutomatic(value, gate);
        await gate.reached;
        deletionPromise = deleteAccount();
      } else {
        deletionPromise = deleteAccount();
        await gate.reached;
        candidatePromise = submitAutomatic(value);
      }
      gate.release();
      const [candidateResult, deletionResult] = await Promise.all([
        candidatePromise,
        deletionPromise,
      ]);

      expect(candidateResult.outcome).toBe(
        order === "candidate-first" ? "credited" : "enrollment_revoked"
      );
      expect(deletionResult).toMatch(/^deleted:/);
      const retained = await database.query<{
        count: string;
        originalSubjectCount: string;
      }>(
        `SELECT count(*) AS "count",
          count(*) FILTER (WHERE "subject" = :subject) AS "originalSubjectCount"
         FROM "LeaderboardCheckins"`,
        { replacements: { subject }, type: QueryTypes.SELECT }
      );
      expect(retained[0]).toEqual({
        count: order === "candidate-first" ? "1" : "0",
        originalSubjectCount: "0",
      });
    }
  );
});
