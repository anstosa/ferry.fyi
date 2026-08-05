import { DataTypes, Model } from "sequelize";
import type { Ticket } from "shared/contracts/tickets";

import { db } from "~/lib/db";

/** retained account ticket lookup */
export class UserTicket extends Model {
  subject!: string;
  ticketId!: string;
  ticketData!: Ticket;
  sourceUpdatedAt!: Date;
}

UserTicket.init(
  {
    sourceUpdatedAt: { allowNull: false, type: DataTypes.DATE },
    subject: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING,
    },
    ticketData: { allowNull: false, type: DataTypes.JSONB },
    ticketId: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.TEXT,
    },
  },
  { sequelize: db, modelName: "UserTicket", tableName: "UserTickets" }
);
