"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("PersistedFareQuotes", {
      id: { allowNull: false, autoIncrement: true, primaryKey: true, type: Sequelize.INTEGER },
      departingTerminalId: { allowNull: false, type: Sequelize.STRING },
      arrivingTerminalId: { allowNull: false, type: Sequelize.STRING },
      tripDate: { allowNull: false, type: Sequelize.DATEONLY },
      roundTrip: { allowNull: false, type: Sequelize.BOOLEAN },
      canonicalSelections: { allowNull: false, type: Sequelize.TEXT },
      sourceCacheFlushDate: { allowNull: false, type: Sequelize.STRING },
      fetchedAt: { allowNull: false, type: Sequelize.INTEGER },
      validFrom: { allowNull: false, type: Sequelize.DATEONLY },
      validThrough: { allowNull: false, type: Sequelize.DATEONLY },
      policyVersion: { allowNull: false, type: Sequelize.STRING },
      quote: { allowNull: false, type: Sequelize.JSONB },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex("PersistedFareQuotes", {
      fields: ["departingTerminalId", "arrivingTerminalId", "tripDate", "roundTrip", "canonicalSelections", "sourceCacheFlushDate"],
      name: "persisted_fare_quotes_exact_generation",
      unique: true,
    });
    await queryInterface.addIndex("PersistedFareQuotes", {
      fields: ["departingTerminalId", "arrivingTerminalId", "tripDate", "canonicalSelections", "fetchedAt"],
      name: "persisted_fare_quotes_stale_lookup",
    });
  },
  down: async (queryInterface) => queryInterface.dropTable("PersistedFareQuotes"),
};
