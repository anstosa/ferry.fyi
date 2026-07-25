import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

// Stores eligibility state only. Coordinates, accuracy, and device timestamps are never persisted.
export class LeaderboardTerminalPresence extends Model {
  exitedAt!: Date | null;
  lastCreditedAt!: Date | null;
  subject!: string;
  terminalId!: string;
}

LeaderboardTerminalPresence.init(
  {
    exitedAt: { allowNull: true, type: DataTypes.DATE },
    lastCreditedAt: { allowNull: true, type: DataTypes.DATE },
    subject: { allowNull: false, type: DataTypes.STRING },
    terminalId: { allowNull: false, type: DataTypes.STRING },
  },
  {
    indexes: [{ fields: ["subject", "terminalId"], unique: true }],
    sequelize: db,
    modelName: "LeaderboardTerminalPresence",
    tableName: "LeaderboardTerminalPresences",
  }
);
