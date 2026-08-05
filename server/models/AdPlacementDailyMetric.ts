import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class AdPlacementDailyMetric extends Model {
  businessDate!: string;
  opportunityCount!: string;
  placementKey!: string;
}

AdPlacementDailyMetric.init(
  {
    businessDate: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.DATEONLY,
    },
    opportunityCount: {
      allowNull: false,
      defaultValue: "0",
      type: DataTypes.BIGINT,
    },
    placementKey: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING,
    },
  },
  {
    sequelize: db,
    timestamps: false,
    modelName: "AdPlacementDailyMetric",
    tableName: "AdPlacementDailyMetrics",
  }
);
