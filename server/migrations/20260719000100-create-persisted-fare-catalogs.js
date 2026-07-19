"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("PersistedFareCatalogs", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      departingTerminalId: { allowNull: false, type: Sequelize.STRING },
      arrivingTerminalId: { allowNull: false, type: Sequelize.STRING },
      tripDate: { allowNull: false, type: Sequelize.DATEONLY },
      fetchedAt: { allowNull: false, type: Sequelize.INTEGER },
      result: { allowNull: false, type: Sequelize.JSONB },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex("PersistedFareCatalogs", ["departingTerminalId", "arrivingTerminalId", "tripDate"], {
      name: "persisted_fare_catalogs_exact_route_date",
      unique: true,
    });
    await queryInterface.addIndex("PersistedFareCatalogs", ["fetchedAt"], {
      name: "persisted_fare_catalogs_refresh_queue",
    });
  },
  down: async (queryInterface) => queryInterface.dropTable("PersistedFareCatalogs"),
};
