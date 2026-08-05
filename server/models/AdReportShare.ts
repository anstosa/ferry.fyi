import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class AdReportShare extends Model {
  campaignId!: string;
  createdAt!: Date;
  id!: string;
  revokedAt!: Date | null;
  tokenHash!: string;
}

AdReportShare.init(
  {
    campaignId: { allowNull: false, type: DataTypes.UUID },
    createdAt: { allowNull: false, type: DataTypes.DATE },
    id: { allowNull: false, primaryKey: true, type: DataTypes.UUID },
    revokedAt: { allowNull: true, type: DataTypes.DATE },
    tokenHash: {
      allowNull: false,
      type: DataTypes.STRING(64),
      unique: true,
    },
  },
  {
    sequelize: db,
    timestamps: false,
    modelName: "AdReportShare",
    tableName: "AdReportShares",
  }
);
