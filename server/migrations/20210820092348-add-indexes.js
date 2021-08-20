"use strict";

module.exports = {
  up: (queryInterface) => {
    return queryInterface.addIndex("Crossings", {
      fields: ["departureTime"],
      name: "indexes_departureTime",
    });
  },

  down: (queryInterface) => {
    return queryInterface.removeIndex("Crossings", "indexes_departureTime");
  },
};
