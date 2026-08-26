import { createRequire } from "node:module";

import { QueryTypes, Sequelize, type Transaction } from "sequelize";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { AutomaticCheckinCandidateV1 } from "../../shared/contracts/leaderboards";
import {
  acquirePostgresIntegrationLock,
  POSTGRES_INTEGRATION_HOOK_TIMEOUT_MS,
} from "./helpers/postgresIntegrationLock";

const require = createRequire(import.meta.url);
const createLeaderboards = require("../../server/migrations/20260723000100-create-leaderboards.js");
const addVerboseNotifications = require("../../server/migrations/20260723000200-add-verbose-leaderboard-notifications.js");
const addAutomaticPreference = require("../../server/migrations/20260724000100-add-automatic-leaderboard-checkins.js");
const createFeatureFlags = require("../../server/migrations/20260724000200-create-feature-flags.js");
const createAutomaticFlag = require("../../server/migrations/20260724000300-add-automatic-checkins-feature-flag.js");
const addFeatureControls = require("../../server/migrations/20260724000400-add-feature-flag-controls.js");
const createEnrollments = require("../../server/migrations/20260817000200-create-leaderboard-automatic-enrollments.js");
const createReceipts = require("../../server/migrations/20260817000300-create-leaderboard-automatic-candidate-receipts.js");
const addLastObservedAt = require("../../server/migrations/20260817000400-add-last-observed-at-to-leaderboard-terminal-presences.js");
const addPolicyGeneration = require("../../server/migrations/20260817000600-add-server-policy-generation-to-feature-flags.js");
const addExpiryObservedAt = require("../../server/migrations/20260817000700-add-expiry-observed-at-to-leaderboard-automatic-enrollments.js");
const restrictEnrollmentDeletion = require("../../server/migrations/20260817000800-restrict-automatic-receipt-enrollment-deletion.js");
const storeFinalPolicyGeneration = require("../../server/migrations/20260817000900-store-final-policy-generation-on-automatic-receipts.js");
const createSupporterBilling = require("../../server/migrations/20260823000100-create-supporter-billing.js");
const defaultSupporterBadge = require("../../server/migrations/20260824000200-default-supporter-badge-visible.js");

const externalDatabaseUrl =
  process.env.LEADERBOARD_AUTOMATIC_RECEIPT_TEST_DATABASE_URL;
// gate real database coverage explicitly
const describePostgres = externalDatabaseUrl ? describe : describe.skip;

const subject = "auth0|receipt-postgres";
const enrollmentId = "223e4567-e89b-42d3-a456-426614174000";
const pepper = "postgres-dedicated-receipt-pepper";
const legacyCandidateKey = "a".repeat(64);

// build one strict database candidate
const candidate = (
  overrides: Partial<AutomaticCheckinCandidateV1> = {}
): AutomaticCheckinCandidateV1 =>
  ({
    accuracyMillimeters: 20_000,
    candidateId: "AAAAAAAAAAAAAAAAAAAAAA",
    capturedAtMs: Date.now() - 1_000,
    configGeneration: 7,
    kind: "terminal",
    latitudeE7: 476_000_000,
    longitudeE7: -1_224_000_000,
    schemaVersion: 1,
    terminalId: "7",
    ...overrides,
  }) as AutomaticCheckinCandidateV1;

// cover real policy and receipt row serialization
describePostgres("automatic candidate receipt Postgres integration", () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const schemaName = `leaderboard_receipts_${process.pid}_${Date.now()}`;
  let admin: Sequelize;
  let coordination: Transaction;
  let database: Sequelize;
  let handler: ReturnType<
    typeof import("../../server/services/leaderboardAutomaticCandidateReceipts").createLeaderboardAutomaticCandidateHandler
  >;
  const proofEvaluator = vi.fn();

  // create one isolated real Postgres policy schema
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
    // scope every migration table reference
    const table = (tableName: string) => ({ schema: schemaName, tableName });
    const scopedQueryInterface = {
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
      // scope changed columns
      changeColumn: (tableName: string, ...args: unknown[]) =>
        queryInterface.changeColumn(
          table(tableName),
          ...(args as [string, object, object?])
        ),
      // scope created tables
      createTable: (tableName: string, ...args: unknown[]) =>
        queryInterface.createTable(table(tableName), ...(args as [object])),
      // scope replaced foreign keys
      removeConstraint: (tableName: string, ...args: unknown[]) =>
        queryInterface.removeConstraint(
          table(tableName),
          ...(args as [string, object])
        ),
    };
    await createLeaderboards.up(scopedQueryInterface, Sequelize);
    await addVerboseNotifications.up(scopedQueryInterface, Sequelize);
    await addAutomaticPreference.up(scopedQueryInterface, Sequelize);
    await createFeatureFlags.up(scopedQueryInterface, Sequelize);
    await createAutomaticFlag.up(scopedQueryInterface, Sequelize);
    await addFeatureControls.up(scopedQueryInterface, Sequelize);
    await createEnrollments.up(scopedQueryInterface, Sequelize);
    await createReceipts.up(scopedQueryInterface, Sequelize);
    await addLastObservedAt.up(scopedQueryInterface, Sequelize);
    await addPolicyGeneration.up(scopedQueryInterface, Sequelize);
    await addExpiryObservedAt.up(scopedQueryInterface, Sequelize);
    await restrictEnrollmentDeletion.up(scopedQueryInterface, Sequelize);
    // keep isolated profile schema current
    await createSupporterBilling.up(scopedQueryInterface, Sequelize);
    await defaultSupporterBadge.up(scopedQueryInterface, Sequelize);
    const now = new Date();
    await database.query(
      `UPDATE "FeatureFlags" SET "enabled" = true, "updatedAt" = :now`,
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
      ) VALUES (
        :enrollmentId, :subject, 'ios', 1, :nonceHash, :tokenDigest,
        ARRAY[
          'automatic-checkins:config:read',
          'automatic-checkins:status:read',
          'automatic-checkins:candidates:write',
          'automatic-checkins:enrollment:revoke'
        ]::text[], true, 'healthy', :now, :now, :expiresAt, null, :now, :now
      )`,
      {
        replacements: {
          enrollmentId,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          nonceHash: "1".repeat(64),
          now,
          subject,
          tokenDigest: "2".repeat(64),
        },
      }
    );
    await database.query(
      `INSERT INTO "LeaderboardAutomaticCandidateReceipts" (
        "enrollmentId", "candidateKey", "payloadDigest", "state", "outcome",
        "attemptCount", "checkinId", "expiresAt", "createdAt", "updatedAt"
      ) VALUES (
        :enrollmentId, :candidateKey, :payloadDigest, 'final_rejected',
        'outside_terminal', 1, null, :expiresAt, :now, :now
      )`,
      {
        replacements: {
          candidateKey: legacyCandidateKey,
          enrollmentId,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          now,
          payloadDigest: "b".repeat(64),
        },
      }
    );
    await storeFinalPolicyGeneration.up(scopedQueryInterface, Sequelize);
    const service =
      await import("../../server/services/leaderboardAutomaticCandidateReceipts");
    proofEvaluator.mockImplementation(
      // insert one proof-owned check-in in the shared transaction
      async ({ candidate: proofCandidate, policy }) => {
        const [rows] = await database.query<{ id: number }>(
          `INSERT INTO "LeaderboardCheckins" (
            "subject", "kind", "entityId", "occurredAt", "createdAt", "updatedAt"
          ) VALUES (
            :subject, 'terminal', :entityId, :occurredAt,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          ) RETURNING "id"`,
          {
            replacements: {
              entityId: proofCandidate.terminalId,
              occurredAt: new Date(proofCandidate.capturedAtMs),
              subject,
            },
            transaction: policy.transaction,
          }
        );
        return {
          checkinId: rows[0].id,
          credited: true,
          disposition: "final",
          outcome: "credited",
        };
      }
    );
    handler = service.createLeaderboardAutomaticCandidateHandler({
      candidateKeyPepper: pepper,
      proofEvaluator,
    });
  }, POSTGRES_INTEGRATION_HOOK_TIMEOUT_MS);

  // remove only the isolated integration schema
  afterAll(async () => {
    // close the scoped runtime pool
    if (database) {
      await database.close();
    }
    await admin.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);

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

  // prove the populated migration freezes and protects final generations
  it("backfills one immutable final generation and enforces its shape", async () => {
    const rows = await database.query<{
      serverPolicyGeneration: string;
    }>(
      `SELECT "serverPolicyGeneration"
       FROM "LeaderboardAutomaticCandidateReceipts"
       WHERE "candidateKey" = :candidateKey`,
      {
        replacements: { candidateKey: legacyCandidateKey },
        type: QueryTypes.SELECT,
      }
    );
    expect(rows[0].serverPolicyGeneration).toBe("0");

    await expect(
      database.query(
        `UPDATE "LeaderboardAutomaticCandidateReceipts"
         SET "serverPolicyGeneration" = 1
         WHERE "candidateKey" = :candidateKey`,
        { replacements: { candidateKey: legacyCandidateKey } }
      )
    ).rejects.toThrow();
    await expect(
      database.query(
        `INSERT INTO "LeaderboardAutomaticCandidateReceipts" (
          "enrollmentId", "candidateKey", "payloadDigest", "state", "outcome",
          "attemptCount", "checkinId", "expiresAt", "serverPolicyGeneration",
          "createdAt", "updatedAt"
        ) VALUES (
          :enrollmentId, :candidateKey, :payloadDigest, 'retryable',
          'temporarily_unavailable', 1, null, :expiresAt, 1, :now, :now
        )`,
        {
          replacements: {
            candidateKey: "c".repeat(64),
            enrollmentId,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            now: new Date(),
            payloadDigest: "d".repeat(64),
          },
        }
      )
    ).rejects.toThrow();
    // reject every final row without its replay generation
    await expect(
      database.query(
        `INSERT INTO "LeaderboardAutomaticCandidateReceipts" (
          "enrollmentId", "candidateKey", "payloadDigest", "state", "outcome",
          "attemptCount", "checkinId", "expiresAt", "serverPolicyGeneration",
          "createdAt", "updatedAt"
        ) VALUES (
          :enrollmentId, :candidateKey, :payloadDigest, 'final_rejected',
          'outside_terminal', 1, null, :expiresAt, null, :now, :now
        )`,
        {
          replacements: {
            candidateKey: "e".repeat(64),
            enrollmentId,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            now: new Date(),
            payloadDigest: "f".repeat(64),
          },
        }
      )
    ).rejects.toThrow();
  });

  // prove first-insert serialization, replay, conflict, and retention dependency
  it("linearizes concurrent receipt creation and rejects enrollment cascade", async () => {
    const original = candidate();
    const request = { candidate: original, enrollmentId, subject };
    const [first, second] = await Promise.all([
      handler(request),
      handler(request),
    ]);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      credited: true,
      disposition: "final",
      outcome: "credited",
    });
    expect(proofEvaluator).toHaveBeenCalledOnce();
    const receiptCounts = await database.query<{ count: string }>(
      `SELECT count(*) AS "count"
       FROM "LeaderboardAutomaticCandidateReceipts"
       WHERE "candidateKey" <> :legacyCandidateKey`,
      {
        replacements: { legacyCandidateKey },
        type: QueryTypes.SELECT,
      }
    );
    const checkinCounts = await database.query<{ count: string }>(
      `SELECT count(*) AS "count" FROM "LeaderboardCheckins"`,
      { type: QueryTypes.SELECT }
    );
    expect(receiptCounts[0].count).toBe("1");
    expect(checkinCounts[0].count).toBe("1");

    const replay = await handler(request);
    expect(replay).toEqual(first);
    expect(proofEvaluator).toHaveBeenCalledOnce();

    const conflict = await handler({
      ...request,
      candidate: { ...original, latitudeE7: original.latitudeE7 + 1 },
    });
    expect(conflict).toMatchObject({
      credited: false,
      outcome: "candidate_conflict",
      serverPolicyGeneration: 1,
    });
    const postAdvanceReplay = await handler(request);
    expect(postAdvanceReplay).toEqual(first);
    expect(postAdvanceReplay.serverPolicyGeneration).toBe(0);
    expect(proofEvaluator).toHaveBeenCalledOnce();
    const enrollmentRows = await database.query<{
      detectorEnabled: boolean;
      revokedAt: Date | null;
    }>(
      `SELECT "detectorEnabled", "revokedAt" FROM "LeaderboardAutomaticEnrollments" WHERE "enrollmentId" = :enrollmentId`,
      { replacements: { enrollmentId }, type: QueryTypes.SELECT }
    );
    expect(enrollmentRows[0]).toMatchObject({
      detectorEnabled: false,
      revokedAt: expect.any(Date),
    });
    await expect(
      database.query(
        `DELETE FROM "LeaderboardAutomaticEnrollments" WHERE "enrollmentId" = :enrollmentId`,
        { replacements: { enrollmentId } }
      )
    ).rejects.toThrow();
    const postConflictReceipts = await database.query<{
      checkinId: number;
      payloadDigest: string;
      state: string;
    }>(
      `SELECT "checkinId", "payloadDigest", "state"
       FROM "LeaderboardAutomaticCandidateReceipts"
       WHERE "candidateKey" <> :legacyCandidateKey`,
      {
        replacements: { legacyCandidateKey },
        type: QueryTypes.SELECT,
      }
    );
    expect(postConflictReceipts[0]).toMatchObject({
      checkinId: expect.any(Number),
      payloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      state: "final_credited",
    });
  });
});
