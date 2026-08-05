import { DataTypes, Model } from "sequelize";
import type { AdSlotId } from "shared/contracts/ads";

import { db } from "~/lib/db";

export class AdCampaign extends Model {
  advertiserName!: string;
  arrivalTerminalId!: string | null;
  body!: string;
  departureTerminalId!: string | null;
  endedEarlyAt!: Date | null;
  endsAt!: Date;
  headline!: string;
  id!: string;
  placementKey!: string;
  reportName!: string;
  slot!: AdSlotId;
  startsAt!: Date;
  targetUrl!: string;
}

AdCampaign.init(
  {
    advertiserName: { allowNull: false, type: DataTypes.STRING },
    arrivalTerminalId: { allowNull: true, type: DataTypes.STRING },
    body: { allowNull: false, type: DataTypes.TEXT },
    departureTerminalId: { allowNull: true, type: DataTypes.STRING },
    endedEarlyAt: { allowNull: true, type: DataTypes.DATE },
    endsAt: { allowNull: false, type: DataTypes.DATE },
    headline: { allowNull: false, type: DataTypes.STRING },
    id: { allowNull: false, primaryKey: true, type: DataTypes.UUID },
    placementKey: { allowNull: false, type: DataTypes.STRING },
    reportName: { allowNull: false, type: DataTypes.STRING },
    slot: { allowNull: false, type: DataTypes.STRING },
    startsAt: { allowNull: false, type: DataTypes.DATE },
    targetUrl: { allowNull: false, type: DataTypes.TEXT },
  },
  { sequelize: db, modelName: "AdCampaign", tableName: "AdCampaigns" }
);
