import { DataTypes, Model } from "sequelize";

import { db } from "~/lib/db";

export type WeatherAdjustmentCapacityType = "driveUp" | "reservable";

export class WeatherCapacityAdjustment extends Model {
  adjustmentSpaces!: number;
  arrivalId!: string;
  calculatedAt!: number;
  capacityType!: WeatherAdjustmentCapacityType;
  departureId!: string;
  effectSize!: number;
  isEnabled!: boolean;
  maxAdjustmentSpaces!: number;
  sampleSize!: number;
  weatherBucket!: string;
}

WeatherCapacityAdjustment.init(
  {
    adjustmentSpaces: DataTypes.FLOAT,
    arrivalId: DataTypes.STRING,
    calculatedAt: DataTypes.INTEGER,
    capacityType: DataTypes.STRING,
    departureId: DataTypes.STRING,
    effectSize: DataTypes.FLOAT,
    isEnabled: DataTypes.BOOLEAN,
    maxAdjustmentSpaces: DataTypes.FLOAT,
    sampleSize: DataTypes.INTEGER,
    weatherBucket: DataTypes.STRING,
  },
  { sequelize: db, modelName: "WeatherCapacityAdjustment" }
);
