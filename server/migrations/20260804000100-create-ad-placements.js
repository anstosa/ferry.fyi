"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("SiteControls", "adsEnabled", {
      allowNull: false,
      defaultValue: false,
      type: Sequelize.BOOLEAN,
    });
    await queryInterface.createTable("AdPlacements", {
      key: { allowNull: false, primaryKey: true, type: Sequelize.STRING },
      slot: { allowNull: false, type: Sequelize.STRING },
      departureTerminalId: { allowNull: true, type: Sequelize.STRING },
      arrivalTerminalId: { allowNull: true, type: Sequelize.STRING },
      enabled: { allowNull: false, defaultValue: false, type: Sequelize.BOOLEAN },
      advertiserName: { allowNull: false, defaultValue: "", type: Sequelize.STRING },
      headline: { allowNull: false, defaultValue: "", type: Sequelize.STRING },
      body: { allowNull: false, defaultValue: "", type: Sequelize.TEXT },
      targetUrl: { allowNull: false, defaultValue: "", type: Sequelize.TEXT },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("AdPlacements");
    await queryInterface.removeColumn("SiteControls", "adsEnabled");
  },
};
