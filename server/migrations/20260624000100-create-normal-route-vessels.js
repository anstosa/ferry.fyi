"use strict";

module.exports = {
  // create normal route vessel table
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("NormalRouteVessels", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      routeId: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      vesselId: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      vesselName: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      isNormal: {
        allowNull: false,
        type: Sequelize.BOOLEAN,
      },
      sampleStartDate: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      sampleEndDate: {
        allowNull: false,
        type: Sequelize.STRING,
      },
      sampleDays: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      daysObserved: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      sailingsObserved: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      positions: {
        allowNull: false,
        defaultValue: [],
        type: Sequelize.JSON,
      },
      observedDates: {
        allowNull: false,
        defaultValue: [],
        type: Sequelize.JSON,
      },
      calculatedAt: {
        allowNull: false,
        type: Sequelize.INTEGER,
      },
      inferenceNotes: {
        allowNull: false,
        type: Sequelize.TEXT,
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
    await queryInterface.addIndex("NormalRouteVessels", {
      fields: ["routeId", "vesselId"],
      name: "normal_route_vessels_route_vessel",
      unique: true,
    });
    await queryInterface.addIndex("NormalRouteVessels", {
      fields: ["routeId", "isNormal"],
      name: "normal_route_vessels_route_normal",
    });
  },

  // drop normal route vessel table
  down: async (queryInterface) => {
    await queryInterface.dropTable("NormalRouteVessels");
  },
};
