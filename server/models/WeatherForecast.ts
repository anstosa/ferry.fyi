import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export class WeatherForecast extends Model {
  cloudCoverPercent!: number | null;
  fetchedAt!: number;
  forecastFor!: number;
  latitude!: number;
  longitude!: number;
  precipitationMm!: number | null;
  provider!: string;
  temperatureC!: number | null;
  terminalId!: string;
  timezone!: string | null;
  windSpeedKmh!: number | null;
}

WeatherForecast.init(
  {
    cloudCoverPercent: DataTypes.FLOAT,
    fetchedAt: DataTypes.INTEGER,
    forecastFor: DataTypes.INTEGER,
    latitude: DataTypes.FLOAT,
    longitude: DataTypes.FLOAT,
    precipitationMm: DataTypes.FLOAT,
    provider: DataTypes.STRING,
    temperatureC: DataTypes.FLOAT,
    terminalId: DataTypes.STRING,
    timezone: DataTypes.STRING,
    windSpeedKmh: DataTypes.FLOAT,
  },
  { sequelize: db, modelName: "WeatherForecast" }
);
