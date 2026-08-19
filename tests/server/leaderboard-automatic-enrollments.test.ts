import { createRequire } from "node:module";

import { DataTypes } from "sequelize";
import { AUTOMATIC_CHECKIN_OUTCOMES } from "shared/contracts/leaderboards";
import { describe, expect, it, vi } from "vitest";

// create a nonconnecting model registry
vi.mock("~/lib/db", async () => {
  const { Sequelize } =
    await vi.importActual<typeof import("sequelize")>("sequelize");
  return {
    db: new Sequelize("postgres://test:testing@localhost:5432/ferryfyi", {
      logging: false,
    }),
  };
});

import { LeaderboardAutomaticCandidateReceipt } from "../../server/models/LeaderboardAutomaticCandidateReceipt";
import {
  LEADERBOARD_AUTOMATIC_NATIVE_SCOPES,
  LeaderboardAutomaticEnrollment,
} from "../../server/models/LeaderboardAutomaticEnrollment";
import { LeaderboardTerminalPresence } from "../../server/models/LeaderboardTerminalPresence";

const require = createRequire(import.meta.url);
const enrollmentMigration = require("../../server/migrations/20260817000200-create-leaderboard-automatic-enrollments.js");
const receiptMigration = require("../../server/migrations/20260817000300-create-leaderboard-automatic-candidate-receipts.js");
const expiryObservedMigration = require("../../server/migrations/20260817000700-add-expiry-observed-at-to-leaderboard-automatic-enrollments.js");

// create isolated migration doubles
const migrationHarness = () => {
  const transaction = { commit: vi.fn(), rollback: vi.fn() };
  const queryInterface = {
    addIndex: vi.fn().mockResolvedValue(undefined),
    addColumn: vi.fn().mockResolvedValue(undefined),
    createTable: vi.fn().mockResolvedValue(undefined),
    dropTable: vi.fn().mockResolvedValue(undefined),
    removeColumn: vi.fn().mockResolvedValue(undefined),
    sequelize: {
      query: vi.fn().mockResolvedValue([[], 0]),
      transaction: vi.fn().mockResolvedValue(transaction),
    },
  };
  return { queryInterface, transaction };
};

// enumerate forbidden durable fields
const prohibitedSensitiveFields = [
  "accuracy",
  "candidateId",
  "deviceModel",
  "entityId",
  "latitude",
  "location",
  "longitude",
  "rawCandidate",
  "requestBody",
  "token",
];

// identify forbidden persistence fields
const isProhibitedSensitiveField = (field: string): boolean =>
  prohibitedSensitiveFields.includes(field);

// cover enrollment schema invariants
describe("automatic leaderboard enrollment persistence", () => {
  // prove the stable policy and credential interface
  it("defines device-minimal enrollment attributes and exact scopes", () => {
    const attributes = LeaderboardAutomaticEnrollment.getAttributes();

    // normalize attribute order
    expect(Object.keys(attributes).sort()).toEqual(
      [
        "capabilityVersion",
        "createdAt",
        "currentTokenDigest",
        "detectorEnabled",
        "enrollmentId",
        "expiryObservedAt",
        "health",
        "healthUpdatedAt",
        "installationNonceHash",
        "platform",
        "predecessorAcknowledgedAt",
        "predecessorTokenDigest",
        "predecessorValidUntil",
        "revokedAt",
        "scopes",
        "subject",
        "tokenExpiresAt",
        "tokenIssuedAt",
        "tokenRotatedAt",
        "updatedAt",
      ].sort()
    );
    expect(attributes.enrollmentId.primaryKey).toBe(true);
    expect(attributes.enrollmentId.type).toBeInstanceOf(DataTypes.UUID);
    expect(attributes.currentTokenDigest.type.options.length).toBe(64);
    expect(attributes.installationNonceHash.type.options.length).toBe(64);
    expect(attributes.scopes.defaultValue).toEqual(
      LEADERBOARD_AUTOMATIC_NATIVE_SCOPES
    );
    // reject sensitive model attributes
    expect(Object.keys(attributes).filter(isProhibitedSensitiveField)).toEqual(
      []
    );
  });

  // prove exactly-once expiry observation is durable
  it("adds the nullable expiry observation marker transactionally", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await expiryObservedMigration.up(queryInterface, DataTypes);

    expect(queryInterface.addColumn).toHaveBeenCalledWith(
      "LeaderboardAutomaticEnrollments",
      "expiryObservedAt",
      expect.objectContaining({ allowNull: true }),
      { transaction }
    );
    expect(queryInterface.sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining("leaderboard_auto_enroll_expiry_observed_order"),
      { transaction }
    );
    expect(queryInterface.sequelize.query.mock.calls[0][0]).toContain(
      '"tokenExpiresAt" <= "expiryObservedAt"'
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // prove the expiry marker follows down policy
  it("removes the expiry observation marker transactionally", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await expiryObservedMigration.down(queryInterface);

    expect(queryInterface.removeColumn).toHaveBeenCalledWith(
      "LeaderboardAutomaticEnrollments",
      "expiryObservedAt",
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // prove schema constraints and cleanup indexes
  it("creates enrollment constraints transactionally", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await enrollmentMigration.up(queryInterface, DataTypes);

    const migrationAttributes = queryInterface.createTable.mock.calls[0][1];
    // reject sensitive migration attributes
    expect(
      Object.keys(migrationAttributes).filter(isProhibitedSensitiveField)
    ).toEqual([]);
    expect(queryInterface.createTable).toHaveBeenCalledWith(
      "LeaderboardAutomaticEnrollments",
      expect.objectContaining({
        currentTokenDigest: expect.objectContaining({ allowNull: false }),
        enrollmentId: expect.objectContaining({ primaryKey: true }),
        predecessorTokenDigest: expect.objectContaining({ allowNull: true }),
        subject: expect.objectContaining({
          onDelete: "CASCADE",
          references: {
            key: "subject",
            model: "LeaderboardProfiles",
          },
        }),
      }),
      { transaction }
    );
    expect(queryInterface.addIndex).toHaveBeenCalledWith(
      "LeaderboardAutomaticEnrollments",
      ["currentTokenDigest"],
      expect.objectContaining({ unique: true })
    );
    const constraintSql = queryInterface.sequelize.query.mock.calls[0][0];
    expect(constraintSql).toContain("leaderboard_auto_enroll_scopes");
    expect(constraintSql).toContain("leaderboard_auto_enroll_rotation_bundle");
    expect(constraintSql).toContain("predecessorAcknowledgedAt");
    expect(constraintSql).toContain('tokenIssuedAt" < "tokenExpiresAt');
    // require every least-privilege scope
    for (const scope of LEADERBOARD_AUTOMATIC_NATIVE_SCOPES) {
      expect(constraintSql).toContain(scope);
    }
    expect(transaction.commit).toHaveBeenCalledOnce();
    expect(transaction.rollback).not.toHaveBeenCalled();
  });

  // prove rollback does not leave a partial schema
  it("rolls back enrollment creation failures", async () => {
    const { queryInterface, transaction } = migrationHarness();
    queryInterface.addIndex.mockRejectedValueOnce(new Error("index failed"));

    await expect(
      enrollmentMigration.up(queryInterface, DataTypes)
    ).rejects.toThrow("index failed");

    expect(transaction.rollback).toHaveBeenCalledOnce();
    expect(transaction.commit).not.toHaveBeenCalled();
  });
});

// cover receipt schema invariants
describe("automatic leaderboard receipt persistence", () => {
  // prove the privacy-minimal receipt interface
  it("defines only payload-bound receipt attributes", () => {
    const attributes = LeaderboardAutomaticCandidateReceipt.getAttributes();

    // normalize attribute order
    expect(Object.keys(attributes).sort()).toEqual(
      [
        "attemptCount",
        "candidateKey",
        "checkinId",
        "createdAt",
        "enrollmentId",
        "expiresAt",
        "id",
        "outcome",
        "payloadDigest",
        "serverPolicyGeneration",
        "state",
        "updatedAt",
      ].sort()
    );
    expect(attributes.candidateKey.type.options.length).toBe(64);
    expect(attributes.payloadDigest.type.options.length).toBe(64);
    // reject sensitive model attributes
    expect(Object.keys(attributes).filter(isProhibitedSensitiveField)).toEqual(
      []
    );
  });

  // prove uniqueness, foreign keys, and final-state guards
  it("creates receipt constraints transactionally", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await receiptMigration.up(queryInterface, DataTypes);

    const migrationAttributes = queryInterface.createTable.mock.calls[0][1];
    // reject sensitive migration attributes
    expect(
      Object.keys(migrationAttributes).filter(isProhibitedSensitiveField)
    ).toEqual([]);
    expect(queryInterface.createTable).toHaveBeenCalledWith(
      "LeaderboardAutomaticCandidateReceipts",
      expect.objectContaining({
        checkinId: expect.objectContaining({
          onDelete: "RESTRICT",
          references: { key: "id", model: "LeaderboardCheckins" },
        }),
        enrollmentId: expect.objectContaining({
          onDelete: "CASCADE",
          references: {
            key: "enrollmentId",
            model: "LeaderboardAutomaticEnrollments",
          },
        }),
      }),
      { transaction }
    );
    expect(queryInterface.addIndex).toHaveBeenCalledWith(
      "LeaderboardAutomaticCandidateReceipts",
      ["enrollmentId", "candidateKey"],
      expect.objectContaining({ unique: true })
    );
    const constraintSql = queryInterface.sequelize.query.mock.calls[0][0];
    expect(constraintSql).toContain("leaderboard_auto_receipt_final_shape");
    expect(constraintSql).toContain(
      "protect_leaderboard_automatic_receipt_update"
    );
    expect(constraintSql).toContain(
      'OLD."payloadDigest" IS DISTINCT FROM NEW."payloadDigest"'
    );
    expect(constraintSql).toContain("OLD.\"state\" <> 'retryable'");
    // require every fixed shared outcome
    for (const outcome of AUTOMATIC_CHECKIN_OUTCOMES) {
      expect(constraintSql).toContain(`'${outcome}'`);
    }
    expect(transaction.commit).toHaveBeenCalledOnce();
  });

  // prove down removes the guard before its table
  it("drops receipt guards and state transactionally", async () => {
    const { queryInterface, transaction } = migrationHarness();

    await receiptMigration.down(queryInterface);

    expect(queryInterface.sequelize.query).toHaveBeenCalledWith(
      expect.stringContaining(
        "protect_leaderboard_automatic_receipt_update_trigger"
      ),
      { transaction }
    );
    expect(queryInterface.dropTable).toHaveBeenCalledWith(
      "LeaderboardAutomaticCandidateReceipts",
      { transaction }
    );
    expect(transaction.commit).toHaveBeenCalledOnce();
  });
});

// cover shared presence chronology shape
describe("leaderboard terminal presence persistence", () => {
  // prove new rows may begin without observed chronology
  it("defines nullable lastObservedAt", () => {
    const attributes = LeaderboardTerminalPresence.getAttributes();

    expect(attributes.lastObservedAt).toBeDefined();
    expect(attributes.lastObservedAt.allowNull).toBe(true);
  });
});
