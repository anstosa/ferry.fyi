import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

/** Pseudonymous RevenueCat identity linked to one current account. */
export class SupporterCustomer extends Model {
  adsEnabled!: boolean;
  createdAt!: Date;
  detachedAt!: Date | null;
  id!: string;
  runtimeProjectionGeneration!: string;
  subject!: string | null;
  updatedAt!: Date;
}

SupporterCustomer.init(
  {
    adsEnabled: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    detachedAt: { allowNull: true, type: DataTypes.DATE },
    id: {
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      type: DataTypes.UUID,
    },
    runtimeProjectionGeneration: {
      allowNull: false,
      defaultValue: "0",
      type: DataTypes.BIGINT,
    },
    subject: { allowNull: true, type: DataTypes.STRING, unique: true },
  },
  {
    sequelize: db,
    modelName: "SupporterCustomer",
    tableName: "SupporterCustomers",
  }
);
