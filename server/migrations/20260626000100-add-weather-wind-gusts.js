"use strict";

module.exports = {
  // add gust columns
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("WeatherObservations", "windGustKmh", {
      type: Sequelize.FLOAT,
    });
    await queryInterface.addColumn("WeatherForecasts", "windGustKmh", {
      type: Sequelize.FLOAT,
    });
  },

  // remove gust columns
  down: async (queryInterface) => {
    await queryInterface.removeColumn("WeatherForecasts", "windGustKmh");
    await queryInterface.removeColumn("WeatherObservations", "windGustKmh");
  },
};
