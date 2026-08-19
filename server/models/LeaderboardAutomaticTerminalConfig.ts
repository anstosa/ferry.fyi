import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

/** immutable terminal-region generation */
export class LeaderboardAutomaticTerminalConfig extends Model {
  activatedAt!: Date;
  configGeneration!: number | string;
  contentHash!: string;
  generatedAt!: Date;
  regionJson!: string;
  retainUntil!: Date;
  schemaVersion!: number;
}

LeaderboardAutomaticTerminalConfig.init(
  {
    activatedAt: { allowNull: false, type: DataTypes.DATE },
    configGeneration: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.BIGINT,
    },
    contentHash: { allowNull: false, type: DataTypes.STRING(64) },
    generatedAt: { allowNull: false, type: DataTypes.DATE },
    regionJson: { allowNull: false, type: DataTypes.TEXT },
    retainUntil: { allowNull: false, type: DataTypes.DATE },
    schemaVersion: { allowNull: false, type: DataTypes.INTEGER },
  },
  {
    indexes: [
      {
        fields: ["activatedAt", "configGeneration"],
        name: "leaderboard_automatic_terminal_configs_current",
      },
      {
        fields: ["retainUntil"],
        name: "leaderboard_automatic_terminal_configs_retention",
      },
    ],
    sequelize: db,
    modelName: "LeaderboardAutomaticTerminalConfig",
    tableName: "LeaderboardAutomaticTerminalConfigs",
    timestamps: false,
  }
);
