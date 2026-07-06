"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // create demand event table
    await queryInterface.createTable("DemandEvents", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      eventType: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      title: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      location: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      startsAt: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      endsAt: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      pressure: {
        allowNull: false,
        type: Sequelize.FLOAT,
      },
      source: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      sourceId: {
        allowNull: false,
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
    // enforce event identity
    await queryInterface.addIndex("DemandEvents", {
      fields: ["source", "sourceId"],
      name: "demand_events_source_source_id",
      unique: true,
    });
    // lookup event windows
    await queryInterface.addIndex("DemandEvents", {
      fields: ["startsAt", "endsAt", "eventType"],
      name: "demand_events_window_type",
    });

    // create calibration table
    await queryInterface.createTable("ForecastCalibrations", {
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
      year: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      routeClass: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      sampleSize: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      mae: {
        allowNull: false,
        type: Sequelize.FLOAT,
      },
      p90: {
        allowNull: false,
        type: Sequelize.FLOAT,
      },
      lowMissRate: {
        allowNull: false,
        type: Sequelize.FLOAT,
      },
      highMissRate: {
        allowNull: false,
        type: Sequelize.FLOAT,
      },
      fullBias: {
        allowNull: false,
        type: Sequelize.FLOAT,
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
    // enforce route-year identity
    await queryInterface.addIndex("ForecastCalibrations", {
      fields: ["departureId", "arrivalId", "year"],
      name: "forecast_calibrations_pair_year",
      unique: true,
    });
  },

  down: async (queryInterface) => {
    // remove calibration table
    await queryInterface.dropTable("ForecastCalibrations");
    // remove demand events table
    await queryInterface.dropTable("DemandEvents");
  },
};
