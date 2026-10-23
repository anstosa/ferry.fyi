"use strict";

module.exports = {
  // create the single-row pipeline state table
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("OpenaiCameraPipelineStates", {
      key: {
        allowNull: false,
        primaryKey: true,
        type: Sequelize.STRING(32),
      },
      state: { allowNull: false, type: Sequelize.JSONB },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
  },

  // remove only the pipeline state table
  down: async (queryInterface) => {
    await queryInterface.dropTable("OpenaiCameraPipelineStates");
  },
};
