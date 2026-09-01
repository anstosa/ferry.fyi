"use strict";

module.exports = {
  // add the monotonic reporting-start marker
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn(
      "Crossings",
      "capacityReportingStartedAt",
      {
        allowNull: true,
        type: Sequelize.INTEGER,
      }
    );
  },

  // remove only the reporting-start marker
  down: async (queryInterface) => {
    await queryInterface.removeColumn(
      "Crossings",
      "capacityReportingStartedAt"
    );
  },
};
