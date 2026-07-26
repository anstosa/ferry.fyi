import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

/**
 * The current state of one allowlisted maintenance operation. This is
 * intentionally a single overwritten row, not an execution/audit history.
 */
export class AdminOperationStatus extends Model {
  endedAt!: Date | null;
  error!: string | null;
  leaseExpiresAt!: Date | null;
  leaseToken!: string | null;
  operation!: string;
  result!: string | null;
  startedAt!: Date | null;
  status!: "idle" | "running" | "succeeded" | "failed";
}

AdminOperationStatus.init(
  {
    endedAt: { allowNull: true, type: DataTypes.DATE },
    error: { allowNull: true, type: DataTypes.STRING(240) },
    leaseExpiresAt: { allowNull: true, type: DataTypes.DATE },
    leaseToken: { allowNull: true, type: DataTypes.STRING(64) },
    operation: { allowNull: false, primaryKey: true, type: DataTypes.STRING },
    result: { allowNull: true, type: DataTypes.STRING(240) },
    startedAt: { allowNull: true, type: DataTypes.DATE },
    status: {
      allowNull: false,
      defaultValue: "idle",
      type: DataTypes.STRING(16),
    },
  },
  {
    sequelize: db,
    modelName: "AdminOperationStatus",
    tableName: "AdminOperationStatuses",
  }
);
