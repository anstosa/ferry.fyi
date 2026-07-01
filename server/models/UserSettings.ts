import { DataTypes, Model } from "sequelize";
import type { AppMetadata } from "shared/contracts/user";

import { db } from "~/lib/db";

// persisted user app state
export class UserSettings extends Model {
  subject!: string;
  appMetadata!: AppMetadata;
}

UserSettings.init(
  {
    appMetadata: {
      allowNull: false,
      defaultValue: {},
      type: DataTypes.JSONB,
    },
    subject: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING,
    },
  },
  { sequelize: db, modelName: "UserSettings", tableName: "UserSettings" }
);
