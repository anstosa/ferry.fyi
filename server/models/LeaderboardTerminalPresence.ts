import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

// stores eligibility state without location evidence
export class LeaderboardTerminalPresence extends Model {
  exitedAt!: Date | null;
  lastCreditedAt!: Date | null;
  lastObservedAt!: Date | null;
  subject!: string;
  terminalId!: string;
}

// initialize shared presence chronology
LeaderboardTerminalPresence.init(
  {
    exitedAt: { allowNull: true, type: DataTypes.DATE },
    lastCreditedAt: { allowNull: true, type: DataTypes.DATE },
    lastObservedAt: { allowNull: true, type: DataTypes.DATE },
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
