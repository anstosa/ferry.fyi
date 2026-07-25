"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn(
      "LeaderboardProfiles",
      "automaticCheckinsEnabled",
      {
        allowNull: false,
        defaultValue: true,
        type: Sequelize.BOOLEAN,
      }
    );
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn(
      "LeaderboardProfiles",
      "automaticCheckinsEnabled"
    );
  },
};
