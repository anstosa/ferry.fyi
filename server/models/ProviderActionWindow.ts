import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

/** Durable fixed-window provider action admission. */
export class ProviderActionWindow extends Model {
  action!: string;
  count!: number;
  fixedWindowStart!: Date;
  principalKey!: string;
  principalKind!: "account" | "ip";
}

ProviderActionWindow.init(
  {
    action: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(64),
    },
    count: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    fixedWindowStart: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.DATE,
    },
    principalKey: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(80),
    },
    principalKind: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(16),
    },
  },
  {
    indexes: [
      { fields: ["fixedWindowStart"], name: "provider_action_windows_cleanup" },
    ],
    sequelize: db,
    modelName: "ProviderActionWindow",
    tableName: "ProviderActionWindows",
  }
);
