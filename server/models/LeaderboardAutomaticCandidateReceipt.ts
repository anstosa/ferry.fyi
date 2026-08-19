import { DataTypes, Model } from "sequelize";
import type { AutomaticCheckinOutcome } from "shared/contracts/leaderboards";

import { db } from "~/lib/db";

// name one persisted receipt state
export type LeaderboardAutomaticCandidateReceiptState =
  | "final_credited"
  | "final_rejected"
  | "retryable";

/** privacy-minimal payload-bound idempotency receipt */
export class LeaderboardAutomaticCandidateReceipt extends Model {
  attemptCount!: number;
  candidateKey!: string;
  checkinId!: number | null;
  createdAt!: Date;
  enrollmentId!: string;
  expiresAt!: Date;
  id!: number | string;
  outcome!: AutomaticCheckinOutcome;
  payloadDigest!: string;
  // retain the exact final response generation
  serverPolicyGeneration!: number | string | null;
  state!: LeaderboardAutomaticCandidateReceiptState;
  updatedAt!: Date;
}

// initialize receipt persistence
LeaderboardAutomaticCandidateReceipt.init(
  {
    attemptCount: {
      allowNull: false,
      defaultValue: 1,
      type: DataTypes.INTEGER,
    },
    candidateKey: { allowNull: false, type: DataTypes.STRING(64) },
    checkinId: { allowNull: true, type: DataTypes.INTEGER },
    enrollmentId: { allowNull: false, type: DataTypes.UUID },
    expiresAt: { allowNull: false, type: DataTypes.DATE },
    id: {
      allowNull: false,
      autoIncrement: true,
      primaryKey: true,
      type: DataTypes.BIGINT,
    },
    outcome: { allowNull: false, type: DataTypes.STRING(40) },
    payloadDigest: { allowNull: false, type: DataTypes.STRING(64) },
    // keep retryable rows generation-free until finalization
    serverPolicyGeneration: { allowNull: true, type: DataTypes.BIGINT },
    state: { allowNull: false, type: DataTypes.STRING(24) },
  },
  {
    indexes: [
      {
        fields: ["enrollmentId", "candidateKey"],
        name: "leaderboard_automatic_receipts_candidate",
        unique: true,
      },
      {
        fields: ["state", "expiresAt"],
        name: "leaderboard_automatic_receipts_retention",
      },
      {
        fields: ["checkinId"],
        name: "leaderboard_automatic_receipts_checkin",
      },
    ],
    sequelize: db,
    modelName: "LeaderboardAutomaticCandidateReceipt",
    tableName: "LeaderboardAutomaticCandidateReceipts",
  }
);
