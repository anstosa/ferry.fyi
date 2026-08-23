import { DataTypes, Model } from "sequelize";
import type { SupporterEnvironment } from "shared/contracts/supporter";

import { db } from "~/lib/db";
import type { RevenueCatWebhookStatus } from "~/models/RevenueCatWebhookEvent";

/** One customer reconciliation target for a webhook. */
export class RevenueCatWebhookEventTarget extends Model {
  completedAt!: Date | null;
  customerId!: string;
  environment!: SupporterEnvironment;
  errorCode!: string | null;
  eventId!: string;
  providerProjectKey!: string;
  requiredGeneration!: string;
  status!: RevenueCatWebhookStatus;
}

RevenueCatWebhookEventTarget.init(
  {
    completedAt: { allowNull: true, type: DataTypes.DATE },
    customerId: { allowNull: false, primaryKey: true, type: DataTypes.UUID },
    environment: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(16),
    },
    errorCode: { allowNull: true, type: DataTypes.STRING(64) },
    eventId: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(256),
    },
    providerProjectKey: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(64),
    },
    requiredGeneration: { allowNull: false, type: DataTypes.BIGINT },
    status: {
      allowNull: false,
      defaultValue: "pending",
      type: DataTypes.STRING(16),
    },
  },
  {
    sequelize: db,
    modelName: "RevenueCatWebhookEventTarget",
    tableName: "RevenueCatWebhookEventTargets",
  }
);
