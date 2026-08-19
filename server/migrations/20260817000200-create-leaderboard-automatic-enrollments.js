"use strict";

// fix the least-privilege scope set
const NATIVE_SCOPES = [
  "automatic-checkins:config:read",
  "automatic-checkins:status:read",
  "automatic-checkins:candidates:write",
  "automatic-checkins:enrollment:revoke",
];

module.exports = {
  // create the installation credential boundary
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep enrollment invariants atomic
    try {
      await queryInterface.createTable(
        "LeaderboardAutomaticEnrollments",
        {
          enrollmentId: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.UUID,
          },
          subject: {
            allowNull: false,
            type: Sequelize.STRING,
            references: {
              key: "subject",
              model: "LeaderboardProfiles",
            },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
          },
          platform: { allowNull: false, type: Sequelize.STRING(16) },
          capabilityVersion: { allowNull: false, type: Sequelize.INTEGER },
          installationNonceHash: {
            allowNull: false,
            type: Sequelize.STRING(64),
          },
          currentTokenDigest: {
            allowNull: false,
            type: Sequelize.STRING(64),
          },
          predecessorTokenDigest: {
            allowNull: true,
            type: Sequelize.STRING(64),
          },
          scopes: {
            allowNull: false,
            defaultValue: NATIVE_SCOPES,
            type: Sequelize.ARRAY(Sequelize.TEXT),
          },
          detectorEnabled: {
            allowNull: false,
            defaultValue: false,
            type: Sequelize.BOOLEAN,
          },
          health: {
            allowNull: false,
            defaultValue: "pending",
            type: Sequelize.STRING(16),
          },
          healthUpdatedAt: { allowNull: false, type: Sequelize.DATE },
          tokenIssuedAt: { allowNull: false, type: Sequelize.DATE },
          tokenExpiresAt: { allowNull: false, type: Sequelize.DATE },
          tokenRotatedAt: { allowNull: true, type: Sequelize.DATE },
          predecessorValidUntil: { allowNull: true, type: Sequelize.DATE },
          predecessorAcknowledgedAt: {
            allowNull: true,
            type: Sequelize.DATE,
          },
          revokedAt: { allowNull: true, type: Sequelize.DATE },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.addIndex(
        "LeaderboardAutomaticEnrollments",
        ["currentTokenDigest"],
        {
          name: "leaderboard_automatic_enrollments_current_token",
          transaction,
          unique: true,
        }
      );
      await queryInterface.addIndex(
        "LeaderboardAutomaticEnrollments",
        ["predecessorTokenDigest"],
        {
          name: "leaderboard_automatic_enrollments_predecessor_token",
          transaction,
        }
      );
      await queryInterface.addIndex(
        "LeaderboardAutomaticEnrollments",
        ["subject", "installationNonceHash"],
        {
          name: "leaderboard_automatic_enrollments_installation",
          transaction,
        }
      );
      await queryInterface.addIndex(
        "LeaderboardAutomaticEnrollments",
        ["tokenExpiresAt", "revokedAt"],
        {
          name: "leaderboard_automatic_enrollments_cleanup",
          transaction,
        }
      );
      await queryInterface.sequelize.query(
        `
        ALTER TABLE "LeaderboardAutomaticEnrollments"
          ADD CONSTRAINT leaderboard_auto_enroll_platform
            CHECK ("platform" IN ('android', 'ios')),
          ADD CONSTRAINT leaderboard_auto_enroll_capability
            CHECK ("capabilityVersion" > 0),
          ADD CONSTRAINT leaderboard_auto_enroll_nonce_hash
            CHECK ("installationNonceHash" ~ '^[0-9a-f]{64}$'),
          ADD CONSTRAINT leaderboard_auto_enroll_current_digest
            CHECK ("currentTokenDigest" ~ '^[0-9a-f]{64}$'),
          ADD CONSTRAINT leaderboard_auto_enroll_predecessor_digest
            CHECK (
              "predecessorTokenDigest" IS NULL OR
              (
                "predecessorTokenDigest" ~ '^[0-9a-f]{64}$' AND
                "predecessorTokenDigest" <> "currentTokenDigest"
              )
            ),
          ADD CONSTRAINT leaderboard_auto_enroll_scopes
            CHECK (
              "scopes" = ARRAY[
                'automatic-checkins:config:read',
                'automatic-checkins:status:read',
                'automatic-checkins:candidates:write',
                'automatic-checkins:enrollment:revoke'
              ]::text[]
            ),
          ADD CONSTRAINT leaderboard_auto_enroll_health
            CHECK ("health" IN ('pending', 'healthy', 'degraded', 'disabled')),
          ADD CONSTRAINT leaderboard_auto_enroll_token_window
            CHECK ("tokenIssuedAt" < "tokenExpiresAt"),
          ADD CONSTRAINT leaderboard_auto_enroll_rotation_bundle
            CHECK (
              (
                "predecessorTokenDigest" IS NULL AND
                "tokenRotatedAt" IS NULL AND
                "predecessorValidUntil" IS NULL AND
                "predecessorAcknowledgedAt" IS NULL
              ) OR (
                "predecessorTokenDigest" IS NOT NULL AND
                "tokenRotatedAt" IS NOT NULL AND
                "predecessorValidUntil" IS NOT NULL AND
                "tokenIssuedAt" = "tokenRotatedAt" AND
                "tokenRotatedAt" <= "predecessorValidUntil" AND
                "predecessorValidUntil" <= "tokenExpiresAt" AND
                (
                  "predecessorAcknowledgedAt" IS NULL OR (
                    "tokenRotatedAt" <= "predecessorAcknowledgedAt" AND
                    "predecessorAcknowledgedAt" <= "predecessorValidUntil"
                  )
                )
              )
            ),
          ADD CONSTRAINT leaderboard_auto_enroll_revocation_order
            CHECK ("revokedAt" IS NULL OR "tokenIssuedAt" <= "revokedAt");
      `,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // roll back partial enrollment state
      await transaction.rollback();
      throw error;
    }
  },

  // remove only enrollment identity state
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep rollback atomic
    try {
      await queryInterface.dropTable("LeaderboardAutomaticEnrollments", {
        transaction,
      });
      await transaction.commit();
    } catch (error) {
      // roll back partial enrollment cleanup
      await transaction.rollback();
      throw error;
    }
  },
};
