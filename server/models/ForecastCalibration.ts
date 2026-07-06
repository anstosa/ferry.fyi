import { DataTypes, Model } from "sequelize";
import type { ForecastRouteClass } from "shared/contracts/schedules";

import { db } from "~/lib/db";
import type { ForecastDaypart } from "~/lib/forecastDaypart";

export class ForecastCalibration extends Model {
  arrivalId!: string;
  calculatedAt!: number;
  daypart!: ForecastDaypart;
  departureId!: string;
  fullBias!: number;
  highMissRate!: number;
  lowMissRate!: number;
  mae!: number;
  p90!: number;
  routeClass!: ForecastRouteClass;
  sampleSize!: number;
  year!: number;
}

ForecastCalibration.init(
  {
    arrivalId: DataTypes.STRING,
    calculatedAt: DataTypes.INTEGER,
    daypart: DataTypes.STRING,
    departureId: DataTypes.STRING,
    fullBias: DataTypes.FLOAT,
    highMissRate: DataTypes.FLOAT,
    lowMissRate: DataTypes.FLOAT,
    mae: DataTypes.FLOAT,
    p90: DataTypes.FLOAT,
    routeClass: DataTypes.STRING,
    sampleSize: DataTypes.INTEGER,
    year: DataTypes.INTEGER,
  },
  { sequelize: db, modelName: "ForecastCalibration" }
);
