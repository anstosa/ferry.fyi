"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("NotificationControls", {
      key: { allowNull: false, primaryKey: true, type: Sequelize.STRING },
      paused: { allowNull: false, defaultValue: false, type: Sequelize.BOOLEAN },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("NotificationControls");
  },
};
