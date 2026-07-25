import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class FeatureFlag extends Model {
  enabled!: boolean;
  name!: string;
}

FeatureFlag.init(
  {
    enabled: { allowNull: false, defaultValue: false, type: DataTypes.BOOLEAN },
    name: { allowNull: false, primaryKey: true, type: DataTypes.STRING },
  },
  { sequelize: db, modelName: "FeatureFlag", tableName: "FeatureFlags" }
);
