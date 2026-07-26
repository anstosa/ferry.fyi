"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("AdminOperationStatuses", {
      operation: { allowNull: false, primaryKey: true, type: Sequelize.STRING },
      status: { allowNull: false, defaultValue: "idle", type: Sequelize.STRING(16) },
      startedAt: { allowNull: true, type: Sequelize.DATE },
      endedAt: { allowNull: true, type: Sequelize.DATE },
      leaseToken: { allowNull: true, type: Sequelize.STRING(64) },
      leaseExpiresAt: { allowNull: true, type: Sequelize.DATE },
      result: { allowNull: true, type: Sequelize.STRING(240) },
      error: { allowNull: true, type: Sequelize.STRING(240) },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex("AdminOperationStatuses", ["leaseExpiresAt"]);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("AdminOperationStatuses");
  },
};
