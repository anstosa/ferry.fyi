import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export type GoogleRoutesSku =
  | "autocomplete_requests"
  | "compute_routes_essentials"
  | "compute_routes_pro";

/** One atomic application-classified Google Routes billing month. */
export class GoogleRoutesUsageMonth extends Model {
  attemptCount!: number;
  knownFailureCount!: number;
  month!: string;
  reached100At!: Date | null;
  reached80At!: Date | null;
  sku!: GoogleRoutesSku;
  successCount!: number;
}

GoogleRoutesUsageMonth.init(
  {
    attemptCount: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.INTEGER,
    },
    knownFailureCount: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.INTEGER,
    },
    month: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(7),
    },
    reached100At: { allowNull: true, type: DataTypes.DATE },
    reached80At: { allowNull: true, type: DataTypes.DATE },
    sku: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(40),
    },
    successCount: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.INTEGER,
    },
  },
  {
    sequelize: db,
    modelName: "GoogleRoutesUsageMonth",
    tableName: "GoogleRoutesUsageMonths",
  }
);
