import { DataTypes, Model } from "sequelize";
import type {
  SupporterEnvironment,
  SupporterLifecycleState,
  SupporterPlanInterval,
  SupporterStore,
} from "shared/contracts/supporter";

import { db } from "~/lib/db";

/** Normalized RevenueCat subscription source. */
export class SupporterSubscription extends Model {
  billingIssueAt!: Date | null;
  currentPeriodEndsAt!: Date | null;
  customerId!: string;
  environment!: SupporterEnvironment;
  lifecycleState!: SupporterLifecycleState;
  planInterval!: SupporterPlanInterval;
  productIdentifier!: string;
  providerProjectKey!: string;
  providerSubscriptionId!: string;
  providerUpdatedAt!: Date | null;
  refundedAt!: Date | null;
  revokedAt!: Date | null;
  startsAt!: Date | null;
  store!: SupporterStore;
  willRenew!: boolean;
}

SupporterSubscription.init(
  {
    billingIssueAt: { allowNull: true, type: DataTypes.DATE },
    currentPeriodEndsAt: { allowNull: true, type: DataTypes.DATE },
    customerId: { allowNull: false, type: DataTypes.UUID },
    environment: {
      allowNull: false,
      type: DataTypes.STRING(16),
    },
    lifecycleState: { allowNull: false, type: DataTypes.STRING(32) },
    planInterval: { allowNull: false, type: DataTypes.STRING(16) },
    productIdentifier: { allowNull: false, type: DataTypes.STRING(256) },
    providerProjectKey: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(64),
    },
    providerSubscriptionId: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(512),
    },
    providerUpdatedAt: { allowNull: true, type: DataTypes.DATE },
    refundedAt: { allowNull: true, type: DataTypes.DATE },
    revokedAt: { allowNull: true, type: DataTypes.DATE },
    startsAt: { allowNull: true, type: DataTypes.DATE },
    store: { allowNull: false, type: DataTypes.STRING(32) },
    willRenew: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
  },
  {
    indexes: [
      {
        fields: [
          "customerId",
          "providerProjectKey",
          "environment",
          "lifecycleState",
        ],
        name: "supporter_subscriptions_runtime",
      },
    ],
    sequelize: db,
    modelName: "SupporterSubscription",
    tableName: "SupporterSubscriptions",
  }
);
