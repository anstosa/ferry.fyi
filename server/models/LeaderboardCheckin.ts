import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class LeaderboardCheckin extends Model {
  entityId!: string;
  kind!: "terminal" | "vessel";
  occurredAt!: Date;
  sailingId!: string | null;
  subject!: string;
}

LeaderboardCheckin.init(
  {
    entityId: { allowNull: false, type: DataTypes.STRING },
    kind: { allowNull: false, type: DataTypes.STRING },
    occurredAt: { allowNull: false, type: DataTypes.DATE },
    sailingId: { allowNull: true, type: DataTypes.STRING },
    subject: { allowNull: false, type: DataTypes.STRING },
  },
  {
    sequelize: db,
    modelName: "LeaderboardCheckin",
    tableName: "LeaderboardCheckins",
  }
);
