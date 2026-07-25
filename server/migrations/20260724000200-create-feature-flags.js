"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("FeatureFlags", {
      name: { allowNull: false, primaryKey: true, type: Sequelize.STRING },
      enabled: { allowNull: false, defaultValue: false, type: Sequelize.BOOLEAN },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.bulkInsert("FeatureFlags", [
      { name: "leaderboards", enabled: false, createdAt: new Date(), updatedAt: new Date() },
    ]);
  },
  down: async (queryInterface) => queryInterface.dropTable("FeatureFlags"),
};
