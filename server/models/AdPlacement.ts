import { DataTypes, Model } from "sequelize";
import type { AdSlotId } from "shared/contracts/ads";

import { db } from "~/lib/db";

export class AdPlacement extends Model {
  advertiserName!: string;
  arrivalTerminalId!: string | null;
  body!: string;
  ctaLabel!: string;
  departureTerminalId!: string | null;
  enabled!: boolean;
  headline!: string;
  key!: string;
  slot!: AdSlotId;
  targetUrl!: string;
}

AdPlacement.init(
  {
    advertiserName: {
      allowNull: false,
      defaultValue: "",
      type: DataTypes.STRING,
    },
    arrivalTerminalId: { allowNull: true, type: DataTypes.STRING },
    body: { allowNull: false, defaultValue: "", type: DataTypes.TEXT },
    ctaLabel: {
      allowNull: false,
      defaultValue: "",
      type: DataTypes.STRING,
    },
    departureTerminalId: { allowNull: true, type: DataTypes.STRING },
    enabled: { allowNull: false, defaultValue: false, type: DataTypes.BOOLEAN },
    headline: { allowNull: false, defaultValue: "", type: DataTypes.STRING },
    key: { allowNull: false, primaryKey: true, type: DataTypes.STRING },
    slot: { allowNull: false, type: DataTypes.STRING },
    targetUrl: { allowNull: false, defaultValue: "", type: DataTypes.TEXT },
  },
  { sequelize: db, modelName: "AdPlacement", tableName: "AdPlacements" }
);
