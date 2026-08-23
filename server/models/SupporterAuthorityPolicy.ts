import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export interface SupporterAuthorityEntry {
  environment: "production" | "sandbox";
  providerProjectKey: string;
  runtimeAuthorized: boolean;
}

/** Deployment-wide supporter authority revision. */
export class SupporterAuthorityPolicy extends Model {
  authorityDigest!: string;
  authoritySet!: SupporterAuthorityEntry[];
  generation!: string;
  id!: string;
  registryRevision!: string;
}

SupporterAuthorityPolicy.init(
  {
    authorityDigest: { allowNull: false, type: DataTypes.STRING(64) },
    authoritySet: { allowNull: false, type: DataTypes.JSONB },
    generation: { allowNull: false, defaultValue: "1", type: DataTypes.BIGINT },
    id: { allowNull: false, primaryKey: true, type: DataTypes.STRING(64) },
    registryRevision: {
      allowNull: false,
      defaultValue: "1",
      type: DataTypes.BIGINT,
    },
  },
  {
    sequelize: db,
    modelName: "SupporterAuthorityPolicy",
    tableName: "SupporterAuthorityPolicies",
  }
);
