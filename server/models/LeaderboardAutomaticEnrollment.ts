import { DataTypes, Model } from "sequelize";
import {
  AUTOMATIC_CHECKIN_NATIVE_SCOPES,
  type AutomaticCheckinNativeScope,
} from "shared/contracts/leaderboards";

import { db } from "~/lib/db";

// define the least-privilege scope set
export const LEADERBOARD_AUTOMATIC_NATIVE_SCOPES = [
  ...AUTOMATIC_CHECKIN_NATIVE_SCOPES,
] as const;

// name one persisted native scope
export type LeaderboardAutomaticNativeScope = AutomaticCheckinNativeScope;

// name one persisted detector health state
export type LeaderboardAutomaticEnrollmentHealth =
  | "degraded"
  | "disabled"
  | "healthy"
  | "pending";

/** device-minimal automatic enrollment identity */
export class LeaderboardAutomaticEnrollment extends Model {
  capabilityVersion!: number;
  createdAt!: Date;
  currentTokenDigest!: string;
  detectorEnabled!: boolean;
  enrollmentId!: string;
  expiryObservedAt!: Date | null;
  health!: LeaderboardAutomaticEnrollmentHealth;
  healthUpdatedAt!: Date;
  installationNonceHash!: string;
  platform!: "android" | "ios";
  predecessorAcknowledgedAt!: Date | null;
  predecessorTokenDigest!: string | null;
  predecessorValidUntil!: Date | null;
  revokedAt!: Date | null;
  scopes!: LeaderboardAutomaticNativeScope[];
  subject!: string;
  tokenExpiresAt!: Date;
  tokenIssuedAt!: Date;
  tokenRotatedAt!: Date | null;
  updatedAt!: Date;
}

// initialize enrollment persistence
LeaderboardAutomaticEnrollment.init(
  {
    capabilityVersion: { allowNull: false, type: DataTypes.INTEGER },
    currentTokenDigest: {
      allowNull: false,
      type: DataTypes.STRING(64),
    },
    detectorEnabled: {
      allowNull: false,
      defaultValue: false,
      type: DataTypes.BOOLEAN,
    },
    enrollmentId: {
      allowNull: false,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      type: DataTypes.UUID,
    },
    expiryObservedAt: { allowNull: true, type: DataTypes.DATE },
    health: {
      allowNull: false,
      defaultValue: "pending",
      type: DataTypes.STRING(16),
    },
    healthUpdatedAt: { allowNull: false, type: DataTypes.DATE },
    installationNonceHash: {
      allowNull: false,
      type: DataTypes.STRING(64),
    },
    platform: { allowNull: false, type: DataTypes.STRING(16) },
    predecessorAcknowledgedAt: { allowNull: true, type: DataTypes.DATE },
    predecessorTokenDigest: {
      allowNull: true,
      type: DataTypes.STRING(64),
    },
    predecessorValidUntil: { allowNull: true, type: DataTypes.DATE },
    revokedAt: { allowNull: true, type: DataTypes.DATE },
    scopes: {
      allowNull: false,
      defaultValue: [...LEADERBOARD_AUTOMATIC_NATIVE_SCOPES],
      type: DataTypes.ARRAY(DataTypes.TEXT),
    },
    subject: { allowNull: false, type: DataTypes.STRING },
    tokenExpiresAt: { allowNull: false, type: DataTypes.DATE },
    tokenIssuedAt: { allowNull: false, type: DataTypes.DATE },
    tokenRotatedAt: { allowNull: true, type: DataTypes.DATE },
  },
  {
    indexes: [
      {
        fields: ["currentTokenDigest"],
        name: "leaderboard_automatic_enrollments_current_token",
        unique: true,
      },
      {
        fields: ["predecessorTokenDigest"],
        name: "leaderboard_automatic_enrollments_predecessor_token",
      },
      {
        fields: ["subject", "installationNonceHash"],
        name: "leaderboard_automatic_enrollments_installation",
      },
      {
        fields: ["tokenExpiresAt", "revokedAt"],
        name: "leaderboard_automatic_enrollments_cleanup",
      },
    ],
    sequelize: db,
    modelName: "LeaderboardAutomaticEnrollment",
    tableName: "LeaderboardAutomaticEnrollments",
  }
);
