import { DataTypes, Model } from "sequelize";
import type { TicketLookupUserAgentProfileId } from "shared/contracts/tickets";

import { db } from "~/lib/db";

/** outbound Wave2Go request policy */
export class TicketLookupControl extends Model {
  key!: string;
  userAgentProfile!: TicketLookupUserAgentProfileId;
}

TicketLookupControl.init(
  {
    key: { allowNull: false, primaryKey: true, type: DataTypes.STRING },
    userAgentProfile: {
      allowNull: false,
      defaultValue: "identified-contact",
      type: DataTypes.STRING,
    },
  },
  {
    sequelize: db,
    modelName: "TicketLookupControl",
    tableName: "TicketLookupControls",
  }
);
