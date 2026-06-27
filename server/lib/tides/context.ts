import { DateTime } from "luxon";
import { Op } from "sequelize";

import { TideForecast } from "~/models/TideForecast";

export interface TideConditions {
  stationId: string;
  waterLevelM: number | null;
}

interface CreateTideForecastContextInput {
  slotTimes: DateTime[];
  terminalId: string;
}

export interface TideForecastContext {
  forecastsByHour: Map<number, TideConditions>;
}

// map forecast tide
const mapForecastTide = (forecast: TideForecast): TideConditions => ({
  stationId: forecast.stationId,
  waterLevelM: forecast.waterLevelM,
});

// load tide forecast context
export const createTideForecastContext = async ({
  slotTimes,
  terminalId,
}: CreateTideForecastContextInput): Promise<TideForecastContext | null> => {
  const forecastHours = Array.from(
    new Set(slotTimes.map((slotTime) => slotTime.startOf("hour").toSeconds()))
  );
  // empty schedule guard
  if (forecastHours.length === 0) {
    return null;
  }
  const forecasts = (await TideForecast.findAll({
    where: {
      forecastFor: { [Op.in]: forecastHours },
      terminalId,
    },
  })) as TideForecast[];
  const forecastsByHour = new Map<number, TideConditions>();
  // forecast mapping
  forecasts.forEach((forecast) => {
    forecastsByHour.set(forecast.forecastFor, mapForecastTide(forecast));
  });
  return { forecastsByHour };
};
