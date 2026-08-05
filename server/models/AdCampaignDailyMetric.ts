import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class AdCampaignDailyMetric extends Model {
  businessDate!: string;
  campaignId!: string;
  clickCount!: string;
  opportunityCount!: string;
  servedCount!: string;
  viewableCount!: string;
}

AdCampaignDailyMetric.init(
  {
    businessDate: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.DATEONLY,
    },
    campaignId: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.UUID,
    },
    clickCount: {
      allowNull: false,
      defaultValue: "0",
      type: DataTypes.BIGINT,
    },
    opportunityCount: {
      allowNull: false,
      defaultValue: "0",
      type: DataTypes.BIGINT,
    },
    servedCount: {
      allowNull: false,
      defaultValue: "0",
      type: DataTypes.BIGINT,
    },
    viewableCount: {
      allowNull: false,
      defaultValue: "0",
      type: DataTypes.BIGINT,
    },
  },
  {
    sequelize: db,
    timestamps: false,
    modelName: "AdCampaignDailyMetric",
    tableName: "AdCampaignDailyMetrics",
  }
);
