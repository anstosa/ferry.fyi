import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

/** Subjects explicitly admitted to a non-public feature. */
export class FeatureFlagAllowlist extends Model {
  name!: string;
  subject!: string;
}

FeatureFlagAllowlist.init(
  {
    name: { allowNull: false, primaryKey: true, type: DataTypes.STRING },
    subject: { allowNull: false, primaryKey: true, type: DataTypes.STRING },
  },
  {
    sequelize: db,
    modelName: "FeatureFlagAllowlist",
    tableName: "FeatureFlagAllowlists",
  }
);
