"use strict";

module.exports = {
  // create payload-bound receipt state
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep receipt invariants atomic
    try {
      await queryInterface.createTable(
        "LeaderboardAutomaticCandidateReceipts",
        {
          id: {
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            type: Sequelize.BIGINT,
          },
          enrollmentId: {
            allowNull: false,
            type: Sequelize.UUID,
            references: {
              key: "enrollmentId",
              model: "LeaderboardAutomaticEnrollments",
            },
            onDelete: "CASCADE",
            onUpdate: "CASCADE",
          },
          candidateKey: { allowNull: false, type: Sequelize.STRING(64) },
          payloadDigest: { allowNull: false, type: Sequelize.STRING(64) },
          state: { allowNull: false, type: Sequelize.STRING(24) },
          outcome: { allowNull: false, type: Sequelize.STRING(40) },
          attemptCount: {
            allowNull: false,
            defaultValue: 1,
            type: Sequelize.INTEGER,
          },
          checkinId: {
            allowNull: true,
            type: Sequelize.INTEGER,
            references: { key: "id", model: "LeaderboardCheckins" },
            onDelete: "RESTRICT",
            onUpdate: "CASCADE",
          },
          expiresAt: { allowNull: false, type: Sequelize.DATE },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.addIndex(
        "LeaderboardAutomaticCandidateReceipts",
        ["enrollmentId", "candidateKey"],
        {
          name: "leaderboard_automatic_receipts_candidate",
          transaction,
          unique: true,
        }
      );
      await queryInterface.addIndex(
        "LeaderboardAutomaticCandidateReceipts",
        ["state", "expiresAt"],
        {
          name: "leaderboard_automatic_receipts_retention",
          transaction,
        }
      );
      await queryInterface.addIndex(
        "LeaderboardAutomaticCandidateReceipts",
        ["checkinId"],
        {
          name: "leaderboard_automatic_receipts_checkin",
          transaction,
        }
      );
      await queryInterface.sequelize.query(
        `
        ALTER TABLE "LeaderboardAutomaticCandidateReceipts"
          ADD CONSTRAINT leaderboard_auto_receipt_candidate_key
            CHECK ("candidateKey" ~ '^[0-9a-f]{64}$'),
          ADD CONSTRAINT leaderboard_auto_receipt_payload_digest
            CHECK ("payloadDigest" ~ '^[0-9a-f]{64}$'),
          ADD CONSTRAINT leaderboard_auto_receipt_state
            CHECK ("state" IN ('retryable', 'final_credited', 'final_rejected')),
          ADD CONSTRAINT leaderboard_auto_receipt_outcome
            CHECK ("outcome" IN (
              'authentication_failed',
              'candidate_conflict',
              'credited',
              'detector_disabled',
              'enrollment_expired',
              'enrollment_revoked',
              'expired',
              'future_timestamp',
              'history_unavailable',
              'history_warming',
              'invalid_candidate',
              'location_accuracy_too_low',
              'malformed_payload',
              'outside_terminal',
              'payload_too_large',
              'policy_disabled',
              'rate_limited',
              'sailing_already_credited',
              'stale_event',
              'temporarily_unavailable',
              'terminal_config_unavailable',
              'terminal_not_found',
              'too_close_to_shore',
              'unsupported_encoding',
              'unsupported_media_type',
              'vessel_not_found'
            )),
          ADD CONSTRAINT leaderboard_auto_receipt_attempts
            CHECK ("attemptCount" > 0),
          ADD CONSTRAINT leaderboard_auto_receipt_final_shape
            CHECK (
              ("state" = 'final_credited' AND "outcome" = 'credited' AND "checkinId" IS NOT NULL) OR
              ("state" = 'final_rejected' AND "outcome" <> 'credited' AND "checkinId" IS NULL) OR
              ("state" = 'retryable' AND "outcome" <> 'credited' AND "checkinId" IS NULL)
            );

        -- protect receipt transitions
        CREATE FUNCTION protect_leaderboard_automatic_receipt_update()
        RETURNS trigger AS $$
        BEGIN
          -- preserve payload identity
          IF OLD."enrollmentId" IS DISTINCT FROM NEW."enrollmentId" OR
             OLD."candidateKey" IS DISTINCT FROM NEW."candidateKey" OR
             OLD."payloadDigest" IS DISTINCT FROM NEW."payloadDigest" OR
             OLD."createdAt" IS DISTINCT FROM NEW."createdAt" OR
             OLD."expiresAt" IS DISTINCT FROM NEW."expiresAt" THEN
            RAISE EXCEPTION 'Leaderboard automatic receipt identity is immutable';
          END IF;

          -- preserve every final result
          IF OLD."state" <> 'retryable' THEN
            RAISE EXCEPTION 'Leaderboard automatic final receipts are immutable';
          END IF;

          -- preserve monotonic attempts
          IF NEW."attemptCount" < OLD."attemptCount" THEN
            RAISE EXCEPTION 'Leaderboard automatic receipt attempts cannot decrease';
          END IF;

          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        -- install the receipt guard
        CREATE TRIGGER protect_leaderboard_automatic_receipt_update_trigger
        BEFORE UPDATE ON "LeaderboardAutomaticCandidateReceipts"
        FOR EACH ROW
        EXECUTE FUNCTION protect_leaderboard_automatic_receipt_update();
      `,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // roll back partial receipt state
      await transaction.rollback();
      throw error;
    }
  },

  // remove only candidate receipt state
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep guard cleanup and rollback atomic
    try {
      await queryInterface.sequelize.query(
        `
        DROP TRIGGER IF EXISTS protect_leaderboard_automatic_receipt_update_trigger
          ON "LeaderboardAutomaticCandidateReceipts";
        DROP FUNCTION IF EXISTS protect_leaderboard_automatic_receipt_update();
      `,
        { transaction }
      );
      await queryInterface.dropTable("LeaderboardAutomaticCandidateReceipts", {
        transaction,
      });
      await transaction.commit();
    } catch (error) {
      // roll back partial receipt cleanup
      await transaction.rollback();
      throw error;
    }
  },
};
