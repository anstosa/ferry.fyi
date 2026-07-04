"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // add capacity freshness marker
    await queryInterface.addColumn(
      "Crossings",
      "capacityReportUpdatedAt",
      Sequelize.INTEGER
    );
  },

  down: async (queryInterface) => {
    // remove capacity freshness marker
    await queryInterface.removeColumn("Crossings", "capacityReportUpdatedAt");
  },
};
