import { DataTypes, Model } from "sequelize";
import type { SupporterEnvironment } from "shared/contracts/supporter";

import { db } from "~/lib/db";

export type RevenueCatWebhookStatus =
  | "failed"
  | "pending"
  | "processing"
  | "succeeded";

/** Minimal durable RevenueCat webhook inbox record. */
export class RevenueCatWebhookEvent extends Model {
  appId!: string | null;
  attemptCount!: number;
  bodyHash!: string;
  environment!: SupporterEnvironment;
  errorCode!: string | null;
  eventId!: string;
  eventTimestamp!: Date;
  eventType!: string;
  nextAttemptAt!: Date;
  processedAt!: Date | null;
  providerProjectKey!: string;
  status!: RevenueCatWebhookStatus;
}

RevenueCatWebhookEvent.init(
  {
    appId: { allowNull: true, type: DataTypes.STRING(128) },
    attemptCount: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.INTEGER,
    },
    bodyHash: { allowNull: false, type: DataTypes.STRING(64) },
    environment: { allowNull: false, type: DataTypes.STRING(16) },
    errorCode: { allowNull: true, type: DataTypes.STRING(64) },
    eventId: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(256),
    },
    eventTimestamp: { allowNull: false, type: DataTypes.DATE },
    eventType: { allowNull: false, type: DataTypes.STRING(64) },
    nextAttemptAt: { allowNull: false, type: DataTypes.DATE },
    processedAt: { allowNull: true, type: DataTypes.DATE },
    providerProjectKey: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(64),
    },
    status: {
      allowNull: false,
      defaultValue: "pending",
      type: DataTypes.STRING(16),
    },
  },
  {
    indexes: [
      {
        fields: ["status", "nextAttemptAt"],
        name: "revenuecat_webhook_events_claimable",
      },
    ],
    sequelize: db,
    modelName: "RevenueCatWebhookEvent",
    tableName: "RevenueCatWebhookEvents",
  }
);
