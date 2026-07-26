"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("NotificationRuntimeStatuses", {
      channel: { allowNull: false, primaryKey: true, type: Sequelize.STRING(64) },
      queuedCount: { allowNull: false, defaultValue: 0, type: Sequelize.INTEGER },
      inFlightCount: { allowNull: false, defaultValue: 0, type: Sequelize.INTEGER },
      requestResult: { allowNull: true, type: Sequelize.STRING(16) },
      expiresAt: { allowNull: true, type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex("NotificationRuntimeStatuses", ["expiresAt"]);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("NotificationRuntimeStatuses");
  },
};
