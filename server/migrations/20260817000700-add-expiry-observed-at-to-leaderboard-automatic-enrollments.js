"use strict";

module.exports = {
  // add the exactly-once expiry marker
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep the lifecycle marker atomic
    try {
      await queryInterface.addColumn(
        "LeaderboardAutomaticEnrollments",
        "expiryObservedAt",
        { allowNull: true, type: Sequelize.DATE },
        { transaction }
      );
      await queryInterface.sequelize.query(
        `
        ALTER TABLE "LeaderboardAutomaticEnrollments"
          ADD CONSTRAINT leaderboard_auto_enroll_expiry_observed_order
            CHECK (
              "expiryObservedAt" IS NULL OR
              "tokenExpiresAt" <= "expiryObservedAt"
            );
      `,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // roll back partial lifecycle state
      await transaction.rollback();
      throw error;
    }
  },

  // remove only the expiry marker
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep rollback atomic
    try {
      await queryInterface.sequelize.query(
        `
        ALTER TABLE "LeaderboardAutomaticEnrollments"
          DROP CONSTRAINT IF EXISTS leaderboard_auto_enroll_expiry_observed_order;
      `,
        { transaction }
      );
      await queryInterface.removeColumn(
        "LeaderboardAutomaticEnrollments",
        "expiryObservedAt",
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // roll back partial lifecycle cleanup
      await transaction.rollback();
      throw error;
    }
  },
};
