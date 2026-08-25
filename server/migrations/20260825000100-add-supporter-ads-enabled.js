"use strict";

// define the opt-in preference column
const adsEnabledColumn = (Sequelize) => ({
  allowNull: false,
  defaultValue: false,
  type: Sequelize.BOOLEAN,
});

module.exports = {
  // add the supporter ad preference
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn(
      "SupporterCustomers",
      "adsEnabled",
      adsEnabledColumn(Sequelize)
    );
  },

  // remove the supporter ad preference
  down: async (queryInterface) => {
    await queryInterface.removeColumn("SupporterCustomers", "adsEnabled");
  },
};
