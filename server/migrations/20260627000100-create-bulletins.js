"use strict";

module.exports = {
  // create bulletin table
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("Bulletins", {
      id: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.STRING,
      },
      terminalId: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      rawTitle: {
        allowNull: false,
        type: Sequelize.TEXT,
      },
      title: {
        allowNull: false,
        type: Sequelize.TEXT,
      },
      bodyHTML: {
        allowNull: false,
        type: Sequelize.TEXT,
      },
      bodyText: {
        allowNull: false,
        type: Sequelize.TEXT,
      },
      date: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      url: {
        type: Sequelize.TEXT,
      },
      level: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      ignoreAll: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      firstSeenAt: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      lastSeenAt: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      inactiveAt: {
        type: Sequelize.INTEGER,
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
    await queryInterface.addIndex("Bulletins", {
      fields: ["terminalId", "inactiveAt", "date"],
      name: "bulletins_terminal_active_date",
    });
    await queryInterface.addIndex("Bulletins", {
      fields: ["terminalId", "lastSeenAt"],
      name: "bulletins_terminal_last_seen",
    });
  },

  // drop bulletin table
  down: async (queryInterface) => {
    await queryInterface.dropTable("Bulletins");
  },
};
