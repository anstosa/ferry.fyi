import { DataTypes, Model } from "sequelize";
import type { SupporterEnvironment } from "shared/contracts/supporter";

import { db } from "~/lib/db";

export type SupporterReconcileState = "failed" | "idle" | "pending" | "running";

/** Cross-process reconciliation generation and lease. */
export class SupporterReconcileWork extends Model {
  attemptCount!: number;
  claimedGeneration!: string;
  completedAt!: Date | null;
  completedGeneration!: string;
  customerId!: string;
  environment!: SupporterEnvironment;
  errorCode!: string | null;
  leaseExpiresAt!: Date | null;
  leaseToken!: string | null;
  nextAttemptAt!: Date;
  providerProjectKey!: string;
  requestedAt!: Date | null;
  requestedGeneration!: string;
  startedAt!: Date | null;
  state!: SupporterReconcileState;
}

SupporterReconcileWork.init(
  {
    attemptCount: {
      allowNull: false,
      defaultValue: 0,
      type: DataTypes.INTEGER,
    },
    claimedGeneration: {
      allowNull: false,
      defaultValue: "0",
      type: DataTypes.BIGINT,
    },
    completedAt: { allowNull: true, type: DataTypes.DATE },
    completedGeneration: {
      allowNull: false,
      defaultValue: "0",
      type: DataTypes.BIGINT,
    },
    customerId: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.UUID,
    },
    environment: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(16),
    },
    errorCode: { allowNull: true, type: DataTypes.STRING(64) },
    leaseExpiresAt: { allowNull: true, type: DataTypes.DATE },
    leaseToken: { allowNull: true, type: DataTypes.UUID },
    nextAttemptAt: { allowNull: false, type: DataTypes.DATE },
    providerProjectKey: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(64),
    },
    requestedAt: { allowNull: true, type: DataTypes.DATE },
    requestedGeneration: {
      allowNull: false,
      defaultValue: "0",
      type: DataTypes.BIGINT,
    },
    startedAt: { allowNull: true, type: DataTypes.DATE },
    state: {
      allowNull: false,
      defaultValue: "idle",
      type: DataTypes.STRING(16),
    },
  },
  {
    indexes: [
      {
        fields: ["state", "nextAttemptAt", "leaseExpiresAt"],
        name: "supporter_reconcile_works_claimable",
      },
    ],
    sequelize: db,
    modelName: "SupporterReconcileWork",
    tableName: "SupporterReconcileWorks",
  }
);
