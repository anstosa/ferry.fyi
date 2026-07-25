import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class LeaderboardProfile extends Model {
  automaticCheckinsEnabled!: boolean;
  displayName!: string;
  notificationsEnabled!: boolean;
  optedOut!: boolean;
  subject!: string;
  useFullName!: boolean;
  verboseNotificationsEnabled!: boolean;
}

LeaderboardProfile.init(
  {
    automaticCheckinsEnabled: {
      allowNull: false,
      defaultValue: true,
      type: DataTypes.BOOLEAN,
    },
    displayName: { allowNull: false, defaultValue: "", type: DataTypes.STRING },
    notificationsEnabled: {
      allowNull: false,
      defaultValue: true,
      type: DataTypes.BOOLEAN,
    },
    optedOut: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    subject: { allowNull: false, primaryKey: true, type: DataTypes.STRING },
    useFullName: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    verboseNotificationsEnabled: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
  },
  {
    sequelize: db,
    modelName: "LeaderboardProfile",
    tableName: "LeaderboardProfiles",
  }
);
