"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // add vessel reference
    await queryInterface.addColumn("Crossings", "vesselId", Sequelize.STRING);
    // add vessel fallback
    await queryInterface.addColumn("Crossings", "vesselName", Sequelize.STRING);
  },

  down: async (queryInterface) => {
    // remove vessel fallback
    await queryInterface.removeColumn("Crossings", "vesselName");
    // remove vessel reference
    await queryInterface.removeColumn("Crossings", "vesselId");
  },
};
