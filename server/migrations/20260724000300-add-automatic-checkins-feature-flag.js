"use strict";
module.exports = {
  up: async (queryInterface) => queryInterface.bulkInsert("FeatureFlags", [{ name: "automaticLeaderboardCheckins", enabled: false, createdAt: new Date(), updatedAt: new Date() }]),
  down: async (queryInterface, Sequelize) => queryInterface.bulkDelete("FeatureFlags", { name: "automaticLeaderboardCheckins" }, {}),
};
