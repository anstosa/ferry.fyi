"use strict";

const receiptTable = "LeaderboardAutomaticCandidateReceipts";
const generationConstraint = "leaderboard_auto_receipt_policy_generation";
const receiptGuard = "protect_leaderboard_automatic_receipt_update_trigger";

module.exports = {
  // retain the generation used for every immutable final response
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();

    // keep backfill and final-shape enforcement atomic
    try {
      await queryInterface.addColumn(
        receiptTable,
        "serverPolicyGeneration",
        { allowNull: true, type: Sequelize.BIGINT },
        { transaction }
      );
      await queryInterface.sequelize.query(
        `
        -- permit only this populated-schema backfill
        ALTER TABLE "${receiptTable}" DISABLE TRIGGER ${receiptGuard};

        -- freeze the best available pre-column generation once
        UPDATE "${receiptTable}"
        SET "serverPolicyGeneration" = COALESCE(
          (
            SELECT "serverPolicyGeneration"
            FROM "FeatureFlags"
            WHERE "name" = 'automaticLeaderboardCheckins'
          ),
          0
        )
        WHERE "state" <> 'retryable';

        -- restore final receipt immutability before releasing the table
        ALTER TABLE "${receiptTable}" ENABLE TRIGGER ${receiptGuard};

        ALTER TABLE "${receiptTable}"
          ADD CONSTRAINT ${generationConstraint}
            CHECK (
              (
                "state" = 'retryable' AND
                "serverPolicyGeneration" IS NULL
              ) OR
              (
                "state" IN ('final_credited', 'final_rejected') AND
                "serverPolicyGeneration" IS NOT NULL AND
                "serverPolicyGeneration" BETWEEN 0 AND 9007199254740991
              )
            );
      `,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // roll back partial replay state
      await transaction.rollback();
      throw error;
    }
  },

  // remove only the stored response generation
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();

    // keep constraint and column removal atomic
    try {
      await queryInterface.removeConstraint(
        receiptTable,
        generationConstraint,
        { transaction }
      );
      await queryInterface.removeColumn(
        receiptTable,
        "serverPolicyGeneration",
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // roll back partial replay rollback
      await transaction.rollback();
      throw error;
    }
  },
};
