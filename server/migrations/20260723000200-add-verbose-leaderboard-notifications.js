"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn(
      "LeaderboardProfiles",
      "verboseNotificationsEnabled",
      {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      }
    );
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn(
      "LeaderboardProfiles",
      "verboseNotificationsEnabled"
    );
  },
};
