"use strict";

module.exports = {
  // create immutable capacity evidence
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep schema and guards atomic
    try {
      await queryInterface.createTable(
        "CapacityObservations",
        {
          id: {
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            type: Sequelize.BIGINT,
          },
          pollId: { allowNull: false, type: Sequelize.UUID },
          allocationGroupId: { allowNull: true, type: Sequelize.UUID },
          triggerPollId: { allowNull: true, type: Sequelize.UUID },
          triggerAllocationGroupId: { allowNull: true, type: Sequelize.UUID },
          departureId: { allowNull: false, type: Sequelize.STRING(16) },
          arrivalId: { allowNull: false, type: Sequelize.STRING(16) },
          departureTime: { allowNull: false, type: Sequelize.BIGINT },
          receivedAt: { allowNull: false, type: Sequelize.BIGINT },
          providerReportedAt: { allowNull: true, type: Sequelize.BIGINT },
          driveUpSpaces: { allowNull: true, type: Sequelize.INTEGER },
          reservableSpaces: { allowNull: true, type: Sequelize.INTEGER },
          driveUpDisplayed: { allowNull: false, type: Sequelize.BOOLEAN },
          reservableDisplayed: { allowNull: false, type: Sequelize.BOOLEAN },
          maxSpaceCount: { allowNull: true, type: Sequelize.INTEGER },
          isCancelled: { allowNull: false, type: Sequelize.BOOLEAN },
          vesselId: { allowNull: true, type: Sequelize.STRING(32) },
          reportingStateAtReceipt: {
            allowNull: false,
            type: Sequelize.STRING(32),
          },
          reportingStartedAtReceipt: {
            allowNull: true,
            type: Sequelize.BIGINT,
          },
          sourceKind: { allowNull: false, type: Sequelize.STRING(24) },
          repairReason: { allowNull: true, type: Sequelize.STRING(48) },
          usableForFillLabel: { allowNull: false, type: Sequelize.BOOLEAN },
          projectedDepartureAt: { allowNull: true, type: Sequelize.BIGINT },
          departureEstimateDriveUpSpaces: {
            allowNull: true,
            type: Sequelize.INTEGER,
          },
          forecastFullProbability: {
            allowNull: true,
            type: Sequelize.DOUBLE,
          },
          forecastFullRisk: { allowNull: true, type: Sequelize.STRING(24) },
          forecastSource: { allowNull: true, type: Sequelize.STRING(24) },
          modelInputSchemaVersion: {
            allowNull: false,
            type: Sequelize.STRING(32),
          },
        },
        { transaction }
      );
      await queryInterface.addIndex(
        "CapacityObservations",
        ["pollId", "allocationGroupId", "arrivalId", "departureTime"],
        {
          name: "capacity_observations_direct_identity",
          transaction,
          unique: true,
        }
      );
      await queryInterface.addIndex(
        "CapacityObservations",
        [
          "triggerPollId",
          "departureId",
          "arrivalId",
          "departureTime",
          "repairReason",
        ],
        {
          name: "capacity_observations_repair_identity",
          transaction,
          unique: true,
        }
      );
      await queryInterface.addIndex(
        "CapacityObservations",
        ["departureId", "arrivalId", "departureTime", "receivedAt"],
        { name: "capacity_observations_sailing_time", transaction }
      );
      await queryInterface.addIndex(
        "CapacityObservations",
        ["allocationGroupId"],
        { name: "capacity_observations_allocation_group", transaction }
      );
      await queryInterface.addIndex("CapacityObservations", ["receivedAt"], {
        name: "capacity_observations_retention",
        transaction,
      });
      await queryInterface.sequelize.query(
        `
        ALTER TABLE "CapacityObservations"
          ADD CONSTRAINT capacity_observations_counts_nonnegative
            CHECK (
              ("driveUpSpaces" IS NULL OR "driveUpSpaces" >= 0) AND
              ("reservableSpaces" IS NULL OR "reservableSpaces" >= 0) AND
              ("maxSpaceCount" IS NULL OR "maxSpaceCount" >= 0) AND
              ("departureEstimateDriveUpSpaces" IS NULL OR "departureEstimateDriveUpSpaces" >= 0)
            ),
          ADD CONSTRAINT capacity_observations_reporting_state_valid
            CHECK ("reportingStateAtReceipt" IN ('active', 'inactive-all-open', 'hidden', 'unknown')),
          ADD CONSTRAINT capacity_observations_source_integrity
            CHECK (
              (
                "sourceKind" = 'wsf-direct' AND
                "allocationGroupId" IS NOT NULL AND
                "triggerPollId" IS NULL AND
                "triggerAllocationGroupId" IS NULL AND
                "repairReason" IS NULL
              ) OR
              (
                "sourceKind" = 'repair-derived' AND
                "allocationGroupId" IS NULL AND
                "triggerPollId" IS NOT NULL AND
                "repairReason" = 'delayed-predecessor-missing' AND
                "usableForFillLabel" = FALSE
              )
            ),
          ADD CONSTRAINT capacity_observations_label_integrity
            CHECK (
              NOT "usableForFillLabel" OR
              (
                "sourceKind" = 'wsf-direct' AND
                "driveUpDisplayed" = TRUE AND
                "driveUpSpaces" IS NOT NULL AND
                "isCancelled" = FALSE AND
                "reportingStateAtReceipt" = 'active'
              )
            );

        CREATE FUNCTION reject_capacity_observation_update()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'Capacity observations are immutable';
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER reject_capacity_observation_update_trigger
        BEFORE UPDATE ON "CapacityObservations"
        FOR EACH ROW
        EXECUTE FUNCTION reject_capacity_observation_update();
      `,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      // roll back partial schema work
      await transaction.rollback();
      throw error;
    }
  },

  // remove only owned observation storage
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep guard cleanup and drop atomic
    try {
      await queryInterface.sequelize.query(
        `
        DROP TRIGGER IF EXISTS reject_capacity_observation_update_trigger
          ON "CapacityObservations";
        DROP FUNCTION IF EXISTS reject_capacity_observation_update();
      `,
        { transaction }
      );
      await queryInterface.dropTable("CapacityObservations", { transaction });
      await transaction.commit();
    } catch (error) {
      // roll back partial cleanup
      await transaction.rollback();
      throw error;
    }
  },
};
