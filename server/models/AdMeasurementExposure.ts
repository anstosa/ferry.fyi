import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class AdMeasurementExposure extends Model {
  businessDate!: string;
  businessHour!: number;
  campaignId!: string | null;
  clickClaimed!: boolean;
  expiresAt!: Date;
  opportunityClaimed!: boolean;
  placementKey!: string;
  servable!: boolean;
  servedClaimed!: boolean;
  tokenHash!: string;
  viewableClaimed!: boolean;
}

AdMeasurementExposure.init(
  {
    businessDate: { allowNull: false, type: DataTypes.DATEONLY },
    businessHour: { allowNull: false, type: DataTypes.SMALLINT },
    campaignId: { allowNull: true, type: DataTypes.UUID },
    clickClaimed: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    expiresAt: { allowNull: false, type: DataTypes.DATE },
    opportunityClaimed: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    placementKey: { allowNull: false, type: DataTypes.STRING },
    servable: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    servedClaimed: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    tokenHash: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(64),
    },
    viewableClaimed: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
  },
  {
    sequelize: db,
    modelName: "AdMeasurementExposure",
    tableName: "AdMeasurementExposures",
  }
);
