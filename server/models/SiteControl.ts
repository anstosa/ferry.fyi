import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class SiteControl extends Model {
  adsEnabled!: boolean;
  crawlerPolicy!: unknown;
  key!: string;
  leaderboardIndexingEnabled!: boolean;
  leaderboardSharingEnabled!: boolean;
  maintenanceEnabled!: boolean;
  maintenanceMessage!: string;
}

SiteControl.init(
  {
    adsEnabled: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    crawlerPolicy: {
      allowNull: false,
      defaultValue: {},
      type: DataTypes.JSONB,
    },
    key: { allowNull: false, primaryKey: true, type: DataTypes.STRING },
    leaderboardIndexingEnabled: {
      allowNull: false,
      defaultValue: true,
      type: DataTypes.BOOLEAN,
    },
    leaderboardSharingEnabled: {
      allowNull: false,
      defaultValue: true,
      type: DataTypes.BOOLEAN,
    },
    maintenanceEnabled: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    maintenanceMessage: {
      allowNull: false,
      defaultValue: "",
      type: DataTypes.TEXT,
    },
  },
  { sequelize: db, modelName: "SiteControl", tableName: "SiteControls" }
);
