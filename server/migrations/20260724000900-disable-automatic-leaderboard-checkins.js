"use strict";

/**
 * Correct profiles created by the initial leaderboard rollout before
 * automatic/background check-ins were removed from scope.
 */
module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn(
      "LeaderboardProfiles",
      "automaticCheckinsEnabled",
      {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      }
    );
    await queryInterface.bulkUpdate(
      "LeaderboardProfiles",
      { automaticCheckinsEnabled: false },
      { automaticCheckinsEnabled: true }
    );
  },
  down: async (queryInterface, Sequelize) => {
    await queryInterface.changeColumn(
      "LeaderboardProfiles",
      "automaticCheckinsEnabled",
      {
        allowNull: false,
        defaultValue: true,
        type: Sequelize.BOOLEAN,
      }
    );
  },
};
