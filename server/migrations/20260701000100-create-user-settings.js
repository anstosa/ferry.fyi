"use strict";

module.exports = {
  // create user settings table
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("UserSettings", {
      subject: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.STRING,
      },
      appMetadata: {
        allowNull: false,
        defaultValue: {},
        type: Sequelize.JSONB,
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });
  },

  // drop user settings table
  down: async (queryInterface) => {
    await queryInterface.dropTable("UserSettings");
  },
};
