"use strict";

module.exports = {
  // add shared terminal chronology
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep column and backfill atomic
    try {
      await queryInterface.addColumn(
        "LeaderboardTerminalPresences",
        "lastObservedAt",
        { allowNull: true, type: Sequelize.DATE },
        { transaction }
      );
      await queryInterface.sequelize.query(
        `
        UPDATE "LeaderboardTerminalPresences"
        SET "lastObservedAt" = GREATEST("lastCreditedAt", "exitedAt")
      `,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // roll back partial chronology state
      await transaction.rollback();
      throw error;
    }
  },

  // remove shared terminal chronology
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep rollback atomic
    try {
      await queryInterface.removeColumn(
        "LeaderboardTerminalPresences",
        "lastObservedAt",
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // roll back partial chronology cleanup
      await transaction.rollback();
      throw error;
    }
  },
};
