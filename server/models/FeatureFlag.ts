import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class FeatureFlag extends Model {
  enabled!: boolean;
  killSwitch!: boolean;
  name!: string;
  // persist canonical automatic policy version
  serverPolicyGeneration!: number | string;
}

FeatureFlag.init(
  {
    enabled: { allowNull: false, defaultValue: false, type: DataTypes.BOOLEAN },
    killSwitch: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    name: { allowNull: false, primaryKey: true, type: DataTypes.STRING },
    // default existing policy to generation zero
    serverPolicyGeneration: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.BIGINT,
    },
  },
  { sequelize: db, modelName: "FeatureFlag", tableName: "FeatureFlags" }
);
