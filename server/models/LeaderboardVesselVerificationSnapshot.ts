import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

/** retained public vessel observation */
export class LeaderboardVesselVerificationSnapshot extends Model {
  arrivingTerminalId!: number | null;
  departedAtSeconds!: number | string | null;
  departingTerminalId!: number;
  headingDegrees!: number;
  id!: number | string;
  inMaintenance!: boolean;
  inService!: boolean;
  isAtDock!: boolean;
  latitude!: number;
  longitude!: number;
  minuteBucketStartMs!: number | string;
  receivedAtMs!: number | string;
  retainUntilMs!: number | string;
  sailingId!: string | null;
  sourceObservedAtMs!: number | string;
  speedKnots!: number;
  vesselId!: string;
}

// define the retained schema
LeaderboardVesselVerificationSnapshot.init(
  {
    arrivingTerminalId: { allowNull: true, type: DataTypes.INTEGER },
    departedAtSeconds: { allowNull: true, type: DataTypes.BIGINT },
    departingTerminalId: { allowNull: false, type: DataTypes.INTEGER },
    headingDegrees: { allowNull: false, type: DataTypes.DOUBLE },
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.BIGINT,
    },
    inMaintenance: { allowNull: false, type: DataTypes.BOOLEAN },
    inService: { allowNull: false, type: DataTypes.BOOLEAN },
    isAtDock: { allowNull: false, type: DataTypes.BOOLEAN },
    latitude: { allowNull: false, type: DataTypes.DOUBLE },
    longitude: { allowNull: false, type: DataTypes.DOUBLE },
    minuteBucketStartMs: { allowNull: false, type: DataTypes.BIGINT },
    receivedAtMs: { allowNull: false, type: DataTypes.BIGINT },
    retainUntilMs: { allowNull: false, type: DataTypes.BIGINT },
    sailingId: { allowNull: true, type: DataTypes.STRING(160) },
    sourceObservedAtMs: { allowNull: false, type: DataTypes.BIGINT },
    speedKnots: { allowNull: false, type: DataTypes.DOUBLE },
    vesselId: { allowNull: false, type: DataTypes.STRING(32) },
  },
  {
    indexes: [
      {
        fields: ["vesselId", "minuteBucketStartMs"],
        name: "leaderboard_vessel_verification_snapshots_vessel_minute",
        unique: true,
      },
      {
        fields: ["sailingId", "sourceObservedAtMs"],
        name: "leaderboard_vessel_verification_snapshots_sailing_source",
      },
      {
        fields: ["retainUntilMs"],
        name: "leaderboard_vessel_verification_snapshots_retention",
      },
    ],
    modelName: "LeaderboardVesselVerificationSnapshot",
    sequelize: db,
    tableName: "LeaderboardVesselVerificationSnapshots",
    timestamps: false,
  }
);
