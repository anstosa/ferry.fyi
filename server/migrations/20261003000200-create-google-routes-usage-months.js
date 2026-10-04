"use strict";

module.exports = {
  // create atomic per-sku Pacific billing counters
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep schema creation atomic
    try {
      await queryInterface.createTable(
        "GoogleRoutesUsageMonths",
        {
          month: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(7),
          },
          sku: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.STRING(40),
          },
          attemptCount: {
            allowNull: false,
            defaultValue: 0,
            type: Sequelize.INTEGER,
          },
          successCount: {
            allowNull: false,
            defaultValue: 0,
            type: Sequelize.INTEGER,
          },
          knownFailureCount: {
            allowNull: false,
            defaultValue: 0,
            type: Sequelize.INTEGER,
          },
          reached80At: { allowNull: true, type: Sequelize.DATE },
          reached100At: { allowNull: true, type: Sequelize.DATE },
          createdAt: { allowNull: false, type: Sequelize.DATE },
          updatedAt: { allowNull: false, type: Sequelize.DATE },
        },
        { transaction }
      );
      await queryInterface.addConstraint("GoogleRoutesUsageMonths", {
        fields: ["sku"],
        name: "google_routes_usage_sku_valid",
        transaction,
        type: "check",
        where: {
          sku: {
            [Sequelize.Op.in]: [
              "compute_routes_essentials",
              "compute_routes_pro",
            ],
          },
        },
      });
      // reject impossible counter states
      await queryInterface.sequelize.query(
        `ALTER TABLE "GoogleRoutesUsageMonths"
         ADD CONSTRAINT "google_routes_usage_counts_valid"
         CHECK (
           "attemptCount" >= 0 AND
           "successCount" >= 0 AND
           "knownFailureCount" >= 0 AND
           "successCount" + "knownFailureCount" <= "attemptCount"
         )`,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // rollback the whole schema change
      await transaction.rollback();
      throw error;
    }
  },

  // remove the usage aggregate
  down: async (queryInterface) => {
    await queryInterface.dropTable("GoogleRoutesUsageMonths");
  },
};
