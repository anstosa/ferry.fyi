import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

// tide observation model
export class TideObservation extends Model {
  datum!: string;
  observedAt!: number;
  provider!: string;
  stationId!: string;
  terminalId!: string;
  timezone!: string;
  waterLevelM!: number | null;
}

TideObservation.init(
  {
    datum: DataTypes.STRING,
    observedAt: DataTypes.INTEGER,
    provider: DataTypes.STRING,
    stationId: DataTypes.STRING,
    terminalId: DataTypes.STRING,
    timezone: DataTypes.STRING,
    waterLevelM: DataTypes.FLOAT,
  },
  { sequelize: db, modelName: "TideObservation" }
);
