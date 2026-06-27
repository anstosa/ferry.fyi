import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

// tide forecast model
export class TideForecast extends Model {
  datum!: string;
  fetchedAt!: number;
  forecastFor!: number;
  provider!: string;
  stationId!: string;
  terminalId!: string;
  timezone!: string;
  waterLevelM!: number | null;
}

TideForecast.init(
  {
    datum: DataTypes.STRING,
    fetchedAt: DataTypes.INTEGER,
    forecastFor: DataTypes.INTEGER,
    provider: DataTypes.STRING,
    stationId: DataTypes.STRING,
    terminalId: DataTypes.STRING,
    timezone: DataTypes.STRING,
    waterLevelM: DataTypes.FLOAT,
  },
  { sequelize: db, modelName: "TideForecast" }
);
