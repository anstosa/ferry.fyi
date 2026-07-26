"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn("FeatureFlags", "killSwitch", {
      allowNull: false,
      defaultValue: false,
      type: Sequelize.BOOLEAN,
    });
    await queryInterface.createTable("FeatureFlagAllowlists", {
      name: { allowNull: false, primaryKey: true, type: Sequelize.STRING },
      subject: { allowNull: false, primaryKey: true, type: Sequelize.STRING },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("FeatureFlagAllowlists");
    await queryInterface.removeColumn("FeatureFlags", "killSwitch");
  },
};
