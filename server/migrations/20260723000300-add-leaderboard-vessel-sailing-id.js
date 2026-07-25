"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("LeaderboardCheckins", "sailingId", {
      allowNull: true,
      type: Sequelize.STRING,
    });
    await queryInterface.addIndex(
      "LeaderboardCheckins",
      ["subject", "kind", "sailingId"],
      { name: "leaderboard_checkins_subject_kind_sailing", unique: true }
    );
  },
  down: async (queryInterface) => {
    await queryInterface.removeIndex(
      "LeaderboardCheckins",
      "leaderboard_checkins_subject_kind_sailing"
    );
    await queryInterface.removeColumn("LeaderboardCheckins", "sailingId");
  },
};
