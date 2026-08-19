"use strict";

const MINUTE_MS = 60 * 1000;
const CANDIDATE_RETENTION_MS = 12 * 60 * 60 * 1000;
const FUTURE_CEILING_MS = 5 * MINUTE_MS;
const SOURCE_CEILING_MS = 5 * MINUTE_MS;
const GAP_CEILING_MS = 10 * MINUTE_MS;
const PROCESSING_CEILING_MS = 5 * MINUTE_MS;
const PRE_FREEZE_RETENTION_MS =
  CANDIDATE_RETENTION_MS +
  FUTURE_CEILING_MS +
  SOURCE_CEILING_MS +
  GAP_CEILING_MS +
  PROCESSING_CEILING_MS;
const MINIMUM_STORAGE_RETENTION_MS =
  PRE_FREEZE_RETENTION_MS + 2 * GAP_CEILING_MS;

module.exports = {
  // create the retained verification store
  up: async (queryInterface, Sequelize) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep schema and guards atomic
    try {
      await queryInterface.createTable(
        "LeaderboardVesselVerificationSnapshots",
        {
          id: {
            allowNull: false,
            autoIncrement: true,
            primaryKey: true,
            type: Sequelize.BIGINT,
          },
          vesselId: { allowNull: false, type: Sequelize.STRING(32) },
          sailingId: { allowNull: true, type: Sequelize.STRING(160) },
          minuteBucketStartMs: { allowNull: false, type: Sequelize.BIGINT },
          sourceObservedAtMs: { allowNull: false, type: Sequelize.BIGINT },
          receivedAtMs: { allowNull: false, type: Sequelize.BIGINT },
          retainUntilMs: { allowNull: false, type: Sequelize.BIGINT },
          latitude: { allowNull: false, type: Sequelize.DOUBLE },
          longitude: { allowNull: false, type: Sequelize.DOUBLE },
          isAtDock: { allowNull: false, type: Sequelize.BOOLEAN },
          inService: { allowNull: false, type: Sequelize.BOOLEAN },
          inMaintenance: { allowNull: false, type: Sequelize.BOOLEAN },
          departingTerminalId: { allowNull: false, type: Sequelize.INTEGER },
          arrivingTerminalId: { allowNull: true, type: Sequelize.INTEGER },
          departedAtSeconds: { allowNull: true, type: Sequelize.BIGINT },
          speedKnots: { allowNull: false, type: Sequelize.DOUBLE },
          headingDegrees: { allowNull: false, type: Sequelize.DOUBLE },
        },
        { transaction }
      );
      await queryInterface.addIndex(
        "LeaderboardVesselVerificationSnapshots",
        ["vesselId", "minuteBucketStartMs"],
        {
          name: "leaderboard_vessel_verification_snapshots_vessel_minute",
          transaction,
          unique: true,
        }
      );
      await queryInterface.addIndex(
        "LeaderboardVesselVerificationSnapshots",
        ["sailingId", "sourceObservedAtMs"],
        {
          name: "leaderboard_vessel_verification_snapshots_sailing_source",
          transaction,
        }
      );
      await queryInterface.addIndex(
        "LeaderboardVesselVerificationSnapshots",
        ["retainUntilMs"],
        {
          name: "leaderboard_vessel_verification_snapshots_retention",
          transaction,
        }
      );
      await queryInterface.sequelize.query(
        `
        ALTER TABLE "LeaderboardVesselVerificationSnapshots"
          ADD CONSTRAINT leaderboard_vessel_snapshot_minute_bucket
            CHECK (
              "minuteBucketStartMs" >= 0 AND
              mod("minuteBucketStartMs", ${MINUTE_MS}) = 0 AND
              "sourceObservedAtMs" >= "minuteBucketStartMs" AND
              "sourceObservedAtMs" < "minuteBucketStartMs" + ${MINUTE_MS}
            ),
          ADD CONSTRAINT leaderboard_vessel_snapshot_receive_order
            CHECK ("receivedAtMs" >= 0),
          ADD CONSTRAINT leaderboard_vessel_snapshot_minimum_retention
            CHECK ("retainUntilMs" >= "sourceObservedAtMs" + ${MINIMUM_STORAGE_RETENTION_MS}),
          ADD CONSTRAINT leaderboard_vessel_snapshot_position
            CHECK (
              "latitude" >= -90 AND "latitude" <= 90 AND
              "longitude" >= -180 AND "longitude" <= 180
            ),
          ADD CONSTRAINT leaderboard_vessel_snapshot_motion
            CHECK (
              "speedKnots" >= 0 AND "speedKnots" <= 100 AND
              "headingDegrees" >= 0 AND "headingDegrees" <= 360
            ),
          ADD CONSTRAINT leaderboard_vessel_snapshot_terminal_ids
            CHECK (
              "departingTerminalId" > 0 AND
              ("arrivingTerminalId" IS NULL OR "arrivingTerminalId" > 0)
            ),
          ADD CONSTRAINT leaderboard_vessel_snapshot_underway_sailing
            CHECK (
              NOT "inService" OR
              "isAtDock" OR
              (
                "sailingId" IS NOT NULL AND
                "arrivingTerminalId" IS NOT NULL AND
                "departedAtSeconds" > 0 AND
                "departingTerminalId" <> "arrivingTerminalId"
              )
            );

        CREATE FUNCTION protect_leaderboard_vessel_snapshot_retention()
        RETURNS trigger AS $$
        BEGIN
          -- reject premature pruning
          IF (extract(epoch FROM clock_timestamp()) * 1000)::bigint < OLD."retainUntilMs" THEN
            RAISE EXCEPTION 'Leaderboard vessel verification snapshot retention has not elapsed';
          END IF;
          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER protect_leaderboard_vessel_snapshot_retention_trigger
        BEFORE DELETE ON "LeaderboardVesselVerificationSnapshots"
        FOR EACH ROW
        EXECUTE FUNCTION protect_leaderboard_vessel_snapshot_retention();
      `,
        { transaction }
      );
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },

  // remove only the owned verification store
  down: async (queryInterface) => {
    const transaction = await queryInterface.sequelize.transaction();
    // keep guard cleanup and drop atomic
    try {
      await queryInterface.sequelize.query(
        `
        DROP TRIGGER IF EXISTS protect_leaderboard_vessel_snapshot_retention_trigger
          ON "LeaderboardVesselVerificationSnapshots";
        DROP FUNCTION IF EXISTS protect_leaderboard_vessel_snapshot_retention();
      `,
        { transaction }
      );
      await queryInterface.dropTable("LeaderboardVesselVerificationSnapshots", {
        transaction,
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  },
};
