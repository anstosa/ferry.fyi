import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class WeatherObservation extends Model {
  cloudCoverPercent!: number | null;
  latitude!: number;
  longitude!: number;
  observedAt!: number;
  precipitationMm!: number | null;
  provider!: string;
  temperatureC!: number | null;
  terminalId!: string;
  timezone!: string | null;
  windGustKmh!: number | null;
  windSpeedKmh!: number | null;
}

WeatherObservation.init(
  {
    cloudCoverPercent: DataTypes.FLOAT,
    latitude: DataTypes.FLOAT,
    longitude: DataTypes.FLOAT,
    observedAt: DataTypes.INTEGER,
    precipitationMm: DataTypes.FLOAT,
    provider: DataTypes.STRING,
    temperatureC: DataTypes.FLOAT,
    terminalId: DataTypes.STRING,
    timezone: DataTypes.STRING,
    windGustKmh: DataTypes.FLOAT,
    windSpeedKmh: DataTypes.FLOAT,
  },
  { sequelize: db, modelName: "WeatherObservation" }
);
