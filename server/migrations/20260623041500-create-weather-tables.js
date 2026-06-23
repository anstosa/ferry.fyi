"use strict";

module.exports = {
  // create weather tables
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("WeatherObservations", {
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
      observedAt: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      latitude: {
        allowNull: false,
        type: Sequelize.FLOAT,
      },
      longitude: {
        allowNull: false,
        type: Sequelize.FLOAT,
      },
      temperatureC: {
        type: Sequelize.FLOAT,
      },
      cloudCoverPercent: {
        type: Sequelize.FLOAT,
      },
      windSpeedKmh: {
        type: Sequelize.FLOAT,
      },
      precipitationMm: {
        type: Sequelize.FLOAT,
      },
      provider: {
        allowNull: false,
        defaultValue: "open-meteo",
        type: Sequelize.STRING,
      },
      timezone: {
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
    await queryInterface.addIndex("WeatherObservations", {
      fields: ["terminalId", "observedAt", "provider"],
      name: "weather_observations_terminal_hour_provider",
      unique: true,
    });

    await queryInterface.createTable("WeatherForecasts", {
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
      forecastFor: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      fetchedAt: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      latitude: {
        allowNull: false,
        type: Sequelize.FLOAT,
      },
      longitude: {
        allowNull: false,
        type: Sequelize.FLOAT,
      },
      temperatureC: {
        type: Sequelize.FLOAT,
      },
      cloudCoverPercent: {
        type: Sequelize.FLOAT,
      },
      windSpeedKmh: {
        type: Sequelize.FLOAT,
      },
      precipitationMm: {
        type: Sequelize.FLOAT,
      },
      provider: {
        allowNull: false,
        defaultValue: "open-meteo",
        type: Sequelize.STRING,
      },
      timezone: {
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
    await queryInterface.addIndex("WeatherForecasts", {
      fields: ["terminalId", "forecastFor", "provider"],
      name: "weather_forecasts_terminal_hour_provider",
      unique: true,
    });

    await queryInterface.createTable("WeatherCapacityAdjustments", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      departureId: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      arrivalId: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      weatherBucket: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      capacityType: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      adjustmentSpaces: {
        allowNull: false,
        type: Sequelize.FLOAT,
      },
      sampleSize: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      effectSize: {
        allowNull: false,
        type: Sequelize.FLOAT,
      },
      maxAdjustmentSpaces: {
        allowNull: false,
        type: Sequelize.FLOAT,
      },
      isEnabled: {
        allowNull: false,
        defaultValue: false,
        type: Sequelize.BOOLEAN,
      },
      calculatedAt: {
        allowNull: false,
        type: Sequelize.INTEGER,
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
    await queryInterface.addIndex("WeatherCapacityAdjustments", {
      fields: ["departureId", "arrivalId", "weatherBucket", "capacityType"],
      name: "weather_capacity_adjustments_route_bucket_type",
      unique: true,
    });
  },

  // drop weather tables
  down: async (queryInterface) => {
    await queryInterface.dropTable("WeatherCapacityAdjustments");
    await queryInterface.dropTable("WeatherForecasts");
    await queryInterface.dropTable("WeatherObservations");
  },
};
