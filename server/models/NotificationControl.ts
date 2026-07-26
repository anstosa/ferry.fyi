import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

/**
 * Singleton-backed global notification policy. It intentionally contains no
 * actor, message, recipient, or delivery history.
 */
export class NotificationControl extends Model {
  key!: string;
  paused!: boolean;
}

NotificationControl.init(
  {
    key: { allowNull: false, primaryKey: true, type: DataTypes.STRING },
    paused: { allowNull: false, defaultValue: false, type: DataTypes.BOOLEAN },
  },
  {
    sequelize: db,
    modelName: "NotificationControl",
    tableName: "NotificationControls",
  }
);
