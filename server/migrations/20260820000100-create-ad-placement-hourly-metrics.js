"use strict";

module.exports = {
  // add pacific-hour inventory storage
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      // preserve in-flight exposure attribution
      await queryInterface.addColumn(
        "AdMeasurementExposures",
        "businessHour",
        {
          allowNull: false,
          defaultValue: Sequelize.literal(
            "(EXTRACT(HOUR FROM CURRENT_TIMESTAMP AT TIME ZONE 'America/Los_Angeles'))"
          ),
          type: Sequelize.SMALLINT,
        },
        { transaction }
      );
      await queryInterface.sequelize.query(
        `UPDATE "AdMeasurementExposures"
         SET "businessHour" = EXTRACT(
           HOUR FROM "createdAt" AT TIME ZONE 'America/Los_Angeles'
         )`,
        { transaction }
      );
      await queryInterface.addConstraint("AdMeasurementExposures", {
        fields: ["businessHour"],
        name: "ad_exposure_business_hour_valid",
        transaction,
        type: "check",
        where: {
          businessHour: { [Sequelize.Op.between]: [0, 23] },
        },
      });
      await queryInterface.createTable(
        "AdPlacementHourlyMetrics",
        {
          businessDate: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.DATEONLY,
          },
          businessHour: {
            allowNull: false,
            primaryKey: true,
            type: Sequelize.SMALLINT,
          },
          opportunityCount: {
            allowNull: false,
            defaultValue: "0",
            type: Sequelize.BIGINT,
          },
          placementKey: {
            allowNull: false,
            onDelete: "RESTRICT",
            onUpdate: "RESTRICT",
            primaryKey: true,
            references: { key: "key", model: "AdPlacements" },
            type: Sequelize.STRING,
          },
        },
        { transaction }
      );
      await queryInterface.addConstraint("AdPlacementHourlyMetrics", {
        fields: ["businessHour"],
        name: "ad_placement_hourly_business_hour_valid",
        transaction,
        type: "check",
        where: {
          businessHour: { [Sequelize.Op.between]: [0, 23] },
        },
      });
      await queryInterface.addConstraint("AdPlacementHourlyMetrics", {
        fields: ["opportunityCount"],
        name: "ad_placement_hourly_metrics_nonnegative",
        transaction,
        type: "check",
        where: { opportunityCount: { [Sequelize.Op.gte]: 0 } },
      });
      await transaction.commit();
    } catch (error) {
      // rollback the whole schema change
      await transaction.rollback();
      throw error;
    }
  },

  // remove pacific-hour inventory storage
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.dropTable("AdPlacementHourlyMetrics", {
        transaction,
      });
      await queryInterface.removeColumn(
        "AdMeasurementExposures",
        "businessHour",
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // rollback the whole schema change
      await transaction.rollback();
      throw error;
    }
  },
};
