"use strict";

module.exports = {
  // create account ticket cache
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("UserTickets", {
      subject: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.STRING,
      },
      ticketId: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.TEXT,
      },
      ticketData: { allowNull: false, type: Sequelize.JSONB },
      sourceUpdatedAt: { allowNull: false, type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },
  // remove account ticket cache
  down: async (queryInterface) => {
    await queryInterface.dropTable("UserTickets");
  },
};
