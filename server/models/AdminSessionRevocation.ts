import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

/**
 * A short-lived, non-identifying application-token revocation watermark.
 * `subjectHash` is an HMAC, never an Auth0 subject.
 */
export class AdminSessionRevocation extends Model {
  expiresAt!: Date;
  revokedAfter!: Date;
  subjectHash!: string;
}

AdminSessionRevocation.init(
  {
    expiresAt: { allowNull: false, type: DataTypes.DATE },
    revokedAfter: { allowNull: false, type: DataTypes.DATE },
    subjectHash: { allowNull: false, primaryKey: true, type: DataTypes.STRING },
  },
  {
    sequelize: db,
    modelName: "AdminSessionRevocation",
    tableName: "AdminSessionRevocations",
  }
);
