"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.createTable("AdminSessionRevocations", {
      subjectHash: { allowNull: false, primaryKey: true, type: Sequelize.STRING },
      revokedAfter: { allowNull: false, type: Sequelize.DATE },
      expiresAt: { allowNull: false, type: Sequelize.DATE },
      createdAt: { allowNull: false, type: Sequelize.DATE },
      updatedAt: { allowNull: false, type: Sequelize.DATE },
    });
    await queryInterface.addIndex("AdminSessionRevocations", ["expiresAt"]);
  },
  down: async (queryInterface) => {
    await queryInterface.dropTable("AdminSessionRevocations");
  },
};
