import { DataTypes, Model } from "sequelize";
import type {
  SupporterAccessState,
  SupporterEnvironment,
  SupporterLifecycleState,
  SupporterStore,
} from "shared/contracts/supporter";

import { db } from "~/lib/db";

/** Reconciled supporter entitlement for one provider scope. */
export class SupporterEntitlement extends Model {
  accessState!: SupporterAccessState;
  activeUntil!: Date | null;
  customerId!: string;
  entitlementIdentifier!: string;
  environment!: SupporterEnvironment;
  lastProviderEventAt!: Date | null;
  lastReconciledAt!: Date;
  lastVerifiedAt!: Date;
  lifecycleState!: SupporterLifecycleState;
  primaryStore!: SupporterStore | null;
  providerProjectKey!: string;
  reconcileGeneration!: string;
  sourceCount!: number;
}

SupporterEntitlement.init(
  {
    accessState: { allowNull: false, type: DataTypes.STRING(16) },
    activeUntil: { allowNull: true, type: DataTypes.DATE },
    customerId: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.UUID,
    },
    entitlementIdentifier: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(128),
    },
    environment: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(16),
    },
    lastProviderEventAt: { allowNull: true, type: DataTypes.DATE },
    lastReconciledAt: { allowNull: false, type: DataTypes.DATE },
    lastVerifiedAt: { allowNull: false, type: DataTypes.DATE },
    lifecycleState: { allowNull: false, type: DataTypes.STRING(32) },
    primaryStore: { allowNull: true, type: DataTypes.STRING(32) },
    providerProjectKey: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(64),
    },
    reconcileGeneration: {
      allowNull: false,
      defaultValue: "0",
      type: DataTypes.BIGINT,
    },
    sourceCount: { allowNull: false, defaultValue: 0, type: DataTypes.INTEGER },
  },
  {
    indexes: [
      {
        fields: ["accessState", "activeUntil"],
        name: "supporter_entitlements_expiry",
      },
    ],
    sequelize: db,
    modelName: "SupporterEntitlement",
    tableName: "SupporterEntitlements",
  }
);
