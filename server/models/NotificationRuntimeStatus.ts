import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

/**
 * Current, short-lived operational aggregates for one notification channel.
 * This deliberately has no payload, recipient, provider receipt, actor, or
 * history columns.
 */
export class NotificationRuntimeStatus extends Model {
  channel!: string;
  expiresAt!: Date | null;
  inFlightCount!: number;
  queuedCount!: number;
  requestResult!: "accepted" | "failed" | "paused" | "unavailable" | null;
}

NotificationRuntimeStatus.init(
  {
    channel: { allowNull: false, primaryKey: true, type: DataTypes.STRING(64) },
    expiresAt: { allowNull: true, type: DataTypes.DATE },
    inFlightCount: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.INTEGER,
    },
    queuedCount: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
    requestResult: { allowNull: true, type: DataTypes.STRING(16) },
  },
  {
    sequelize: db,
    modelName: "NotificationRuntimeStatus",
    tableName: "NotificationRuntimeStatuses",
  }
);
