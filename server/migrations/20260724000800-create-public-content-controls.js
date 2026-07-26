"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("Announcements", {
      id: { allowNull: false, primaryKey: true, type: Sequelize.UUID },
      title: { allowNull: false, defaultValue: "", type: Sequelize.STRING },
      body: { allowNull: false, defaultValue: "", type: Sequelize.TEXT },
      published: { allowNull: false, defaultValue: false, type: Sequelize.BOOLEAN },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.createTable("SiteControls", {
      key: { allowNull: false, primaryKey: true, type: Sequelize.STRING },
      maintenanceEnabled: { allowNull: false, defaultValue: false, type: Sequelize.BOOLEAN },
      maintenanceMessage: { allowNull: false, defaultValue: "", type: Sequelize.TEXT },
      leaderboardIndexingEnabled: { allowNull: false, defaultValue: true, type: Sequelize.BOOLEAN },
      leaderboardSharingEnabled: { allowNull: false, defaultValue: true, type: Sequelize.BOOLEAN },
      crawlerPolicy: { allowNull: false, defaultValue: {}, type: Sequelize.JSONB },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("SiteControls");
    await queryInterface.dropTable("Announcements");
  },
};
