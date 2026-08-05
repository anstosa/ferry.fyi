"use strict";

module.exports = {
  // create lookup controls
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("TicketLookupControls", {
      key: { allowNull: false, primaryKey: true, type: Sequelize.STRING },
      userAgentProfile: {
        allowNull: false,
        defaultValue: "identified-contact",
        type: Sequelize.STRING,
      },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },
  // remove lookup controls
  down: async (queryInterface) => {
    await queryInterface.dropTable("TicketLookupControls");
  },
};
