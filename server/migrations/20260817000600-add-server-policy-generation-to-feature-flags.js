"use strict";

module.exports = {
  // add one monotonic automatic-policy counter
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("FeatureFlags", "serverPolicyGeneration", {
      allowNull: false,
      defaultValue: 0,
      type: Sequelize.BIGINT,
    });
  },

  // remove the policy counter on rollback
  down: async (queryInterface) => {
    await queryInterface.removeColumn("FeatureFlags", "serverPolicyGeneration");
  },
};
