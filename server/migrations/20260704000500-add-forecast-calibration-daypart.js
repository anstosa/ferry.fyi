"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // add daypart column
    await queryInterface.addColumn("ForecastCalibrations", "daypart", {
      allowNull: false,
      defaultValue: "all",
      type: Sequelize.STRING,
    });
    // replace route index
    await queryInterface.removeIndex(
      "ForecastCalibrations",
      "forecast_calibrations_pair_year"
    );
    // enforce daypart identity
    await queryInterface.addIndex(
      "ForecastCalibrations",
      ["departureId", "arrivalId", "year", "daypart"],
      {
        name: "forecast_calibrations_pair_year_daypart_unique",
        unique: true,
      }
    );
  },

  async down(queryInterface) {
    // remove daypart identity
    await queryInterface.removeIndex(
      "ForecastCalibrations",
      "forecast_calibrations_pair_year_daypart_unique"
    );
    // restore route identity
    await queryInterface.addIndex(
      "ForecastCalibrations",
      ["departureId", "arrivalId", "year"],
      {
        name: "forecast_calibrations_pair_year",
        unique: true,
      }
    );
    // drop daypart column
    await queryInterface.removeColumn("ForecastCalibrations", "daypart");
  },
};
