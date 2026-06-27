"use strict";

module.exports = {
  // create tide tables
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("TideObservations", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      terminalId: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      stationId: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      observedAt: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      waterLevelM: {
        type: Sequelize.FLOAT,
      },
      datum: {
        allowNull: false,
        defaultValue: "MLLW",
        type: Sequelize.STRING,
      },
      provider: {
        allowNull: false,
        defaultValue: "noaa-coops",
        type: Sequelize.STRING,
      },
      timezone: {
        allowNull: false,
        defaultValue: "America/Los_Angeles",
        type: Sequelize.STRING,
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
    await queryInterface.addIndex("TideObservations", {
      fields: ["terminalId", "observedAt", "provider"],
      name: "tide_observations_terminal_hour_provider",
      unique: true,
    });
    await queryInterface.addIndex("TideObservations", {
      fields: ["stationId", "observedAt"],
      name: "tide_observations_station_hour",
    });

    await queryInterface.createTable("TideForecasts", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      terminalId: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      stationId: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      forecastFor: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      fetchedAt: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      waterLevelM: {
        type: Sequelize.FLOAT,
      },
      datum: {
        allowNull: false,
        defaultValue: "MLLW",
        type: Sequelize.STRING,
      },
      provider: {
        allowNull: false,
        defaultValue: "noaa-coops",
        type: Sequelize.STRING,
      },
      timezone: {
        allowNull: false,
        defaultValue: "America/Los_Angeles",
        type: Sequelize.STRING,
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
    await queryInterface.addIndex("TideForecasts", {
      fields: ["terminalId", "forecastFor", "provider"],
      name: "tide_forecasts_terminal_hour_provider",
      unique: true,
    });
    await queryInterface.addIndex("TideForecasts", {
      fields: ["stationId", "forecastFor"],
      name: "tide_forecasts_station_hour",
    });
  },

  // drop tide tables
  down: async (queryInterface) => {
    await queryInterface.dropTable("TideForecasts");
    await queryInterface.dropTable("TideObservations");
  },
};
