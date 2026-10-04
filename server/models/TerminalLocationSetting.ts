import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

// persist owner coordinates separately from the upstream terminal cache
export class TerminalLocationSetting extends Model {
  terminalId!: string;
  boothLatitude!: number | null;
  boothLongitude!: number | null;
  dockLatitude!: number | null;
  dockLongitude!: number | null;
  updatedAt!: Date;
}

TerminalLocationSetting.init(
  {
    terminalId: {
      allowNull: false,
      primaryKey: true,
      type: DataTypes.STRING(20),
    },
    boothLatitude: { allowNull: true, type: DataTypes.DOUBLE },
    boothLongitude: { allowNull: true, type: DataTypes.DOUBLE },
    dockLatitude: { allowNull: true, type: DataTypes.DOUBLE },
    dockLongitude: { allowNull: true, type: DataTypes.DOUBLE },
  },
  {
    sequelize: db,
    modelName: "TerminalLocationSetting",
    tableName: "TerminalLocationSettings",
  }
);
