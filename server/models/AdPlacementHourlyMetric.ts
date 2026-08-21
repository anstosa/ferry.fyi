import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class AdPlacementHourlyMetric extends Model {
  businessDate!: string;
  businessHour!: number;
  opportunityCount!: string;
  placementKey!: string;
}

AdPlacementHourlyMetric.init(
  {
    businessDate: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.DATEONLY,
    },
    businessHour: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.SMALLINT,
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
    modelName: "AdPlacementHourlyMetric",
    tableName: "AdPlacementHourlyMetrics",
  }
);
