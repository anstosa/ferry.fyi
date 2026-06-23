import { DateTime } from "luxon";
import { Op } from "sequelize";
import { constrain, round } from "shared/lib/math";

import { Schedule } from "~/models/Schedule";
import { Terminal } from "~/models/Terminal";
import { WeatherCapacityAdjustment } from "~/models/WeatherCapacityAdjustment";
import { WeatherForecast } from "~/models/WeatherForecast";

export const GLOBAL_MAX_WEATHER_ADJUSTMENT_SPACES = 20;
export const MIN_ADJUSTMENT_SAMPLE_SIZE = 8;

export type CapacityType = "driveUp" | "reservable";

export interface CapacityPair {
  driveUpCapacity: number;
  reservableCapacity: number | null;
}

export interface WeatherAdjustmentRule {
  adjustmentSpaces: number;
  capacityType: CapacityType;
  isEnabled: boolean;
  maxAdjustmentSpaces: number;
  sampleSize: number;
  weatherBucket: string;
}

export interface WeatherConditions {
  cloudCoverPercent: number | null;
  precipitationMm: number | null;
  temperatureC: number | null;
  windSpeedKmh: number | null;
}

interface ApplyWeatherAdjustmentInput {
  capacity: CapacityPair;
  liveCapacity: CapacityPair;
  rules: WeatherAdjustmentRule[];
}

interface GetWeatherAdjustedCapacityInput {
  capacity: CapacityPair;
  context?: WeatherAdjustmentContext | null;
  liveCapacity: CapacityPair;
  schedule: Schedule;
  slotTime: DateTime;
  terminal: Terminal | null;
}

interface CreateWeatherAdjustmentContextInput {
  schedule: Schedule;
  slotTimes: DateTime[];
  terminal: Terminal | null;
}

export interface WeatherAdjustmentContext {
  adjustmentsByBucket: Map<string, WeatherAdjustmentRule[]>;
  forecastsByHour: Map<number, WeatherConditions>;
}

// context result type
type WeatherAdjustmentContextResult = Promise<WeatherAdjustmentContext | null>;

// bucket precipitation
export const getPrecipitationBucket = (
  precipitationMm: number | null
): string => {
  // missing precipitation
  if (precipitationMm === null) {
    return "precipitation:unknown";
  }
  // dry weather
  if (precipitationMm <= 0) {
    return "precipitation:none";
  }
  // light rain
  if (precipitationMm < 2.5) {
    return "precipitation:light";
  }
  return "precipitation:moderate-heavy";
};

// bucket wind
export const getWindBucket = (windSpeedKmh: number | null): string => {
  // missing wind
  if (windSpeedKmh === null) {
    return "wind:unknown";
  }
  // calm wind
  if (windSpeedKmh < 15) {
    return "wind:calm";
  }
  // breezy wind
  if (windSpeedKmh < 35) {
    return "wind:breezy";
  }
  return "wind:windy";
};

// bucket clouds
export const getCloudBucket = (cloudCoverPercent: number | null): string => {
  // missing cloud cover
  if (cloudCoverPercent === null) {
    return "cloud:unknown";
  }
  // clear sky
  if (cloudCoverPercent < 25) {
    return "cloud:clear";
  }
  // mixed sky
  if (cloudCoverPercent < 75) {
    return "cloud:mixed";
  }
  return "cloud:overcast";
};

// bucket temperature
export const getTemperatureBucket = (temperatureC: number | null): string => {
  // missing temperature
  if (temperatureC === null) {
    return "temperature:unknown";
  }
  // cold weather
  if (temperatureC < 8) {
    return "temperature:cold";
  }
  // mild weather
  if (temperatureC < 22) {
    return "temperature:mild";
  }
  return "temperature:warm";
};

// build weather buckets
export const getWeatherBuckets = (weather: WeatherConditions): string[] => [
  getPrecipitationBucket(weather.precipitationMm),
  getWindBucket(weather.windSpeedKmh),
  getCloudBucket(weather.cloudCoverPercent),
  getTemperatureBucket(weather.temperatureC),
];

// cap weather adjustment
const capAdjustmentSpaces = (rule: WeatherAdjustmentRule): number => {
  const signalCap = Math.abs(rule.maxAdjustmentSpaces);
  const globalCap = GLOBAL_MAX_WEATHER_ADJUSTMENT_SPACES;
  const cap = Math.min(signalCap, globalCap);
  return constrain(rule.adjustmentSpaces, -cap, cap);
};

// get usable adjustment
const getRuleAdjustment = (rule: WeatherAdjustmentRule): number => {
  // disabled signal
  if (!rule.isEnabled) {
    return 0;
  }
  // weak sample guard
  if (rule.sampleSize < MIN_ADJUSTMENT_SAMPLE_SIZE) {
    return 0;
  }
  return capAdjustmentSpaces(rule);
};

// apply weather adjustment
export const applyWeatherAdjustment = ({
  capacity,
  liveCapacity,
  rules,
}: ApplyWeatherAdjustmentInput): CapacityPair => {
  let driveUpAdjustment = 0;
  let reservableAdjustment = 0;

  // apply enabled rules
  rules.forEach((rule) => {
    const ruleAdjustment = getRuleAdjustment(rule);
    // drive-up rule
    if (rule.capacityType === "driveUp") {
      driveUpAdjustment += ruleAdjustment;
      return;
    }
    reservableAdjustment += ruleAdjustment;
  });

  return {
    driveUpCapacity: constrain(
      round(
        capacity.driveUpCapacity +
          constrain(
            driveUpAdjustment,
            -GLOBAL_MAX_WEATHER_ADJUSTMENT_SPACES,
            GLOBAL_MAX_WEATHER_ADJUSTMENT_SPACES
          )
      ),
      0,
      liveCapacity.driveUpCapacity
    ),
    reservableCapacity: constrain(
      round(
        (capacity.reservableCapacity ?? 0) +
          constrain(
            reservableAdjustment,
            -GLOBAL_MAX_WEATHER_ADJUSTMENT_SPACES,
            GLOBAL_MAX_WEATHER_ADJUSTMENT_SPACES
          )
      ),
      0,
      liveCapacity.reservableCapacity ?? 0
    ),
  };
};

// map adjustment rule
const mapAdjustmentRule = (
  adjustment: WeatherCapacityAdjustment
): WeatherAdjustmentRule => ({
  adjustmentSpaces: adjustment.adjustmentSpaces,
  capacityType: adjustment.capacityType,
  isEnabled: adjustment.isEnabled,
  maxAdjustmentSpaces: adjustment.maxAdjustmentSpaces,
  sampleSize: adjustment.sampleSize,
  weatherBucket: adjustment.weatherBucket,
});

// map forecast weather
const mapForecastWeather = (forecast: WeatherForecast): WeatherConditions => ({
  cloudCoverPercent: forecast.cloudCoverPercent,
  precipitationMm: forecast.precipitationMm,
  temperatureC: forecast.temperatureC,
  windSpeedKmh: forecast.windSpeedKmh,
});

// build adjustment context
export const createWeatherAdjustmentContext = async ({
  schedule,
  slotTimes,
  terminal,
}: CreateWeatherAdjustmentContextInput): WeatherAdjustmentContextResult => {
  // missing terminal guard
  if (!terminal) {
    return null;
  }
  const forecastHours = Array.from(
    new Set(slotTimes.map((slotTime) => slotTime.startOf("hour").toSeconds()))
  );
  // missing slots guard
  if (!forecastHours.length) {
    return {
      adjustmentsByBucket: new Map(),
      forecastsByHour: new Map(),
    };
  }
  const [forecasts, adjustments] = await Promise.all([
    WeatherForecast.findAll({
      where: {
        forecastFor: { [Op.in]: forecastHours },
        terminalId: schedule.terminalId,
      },
    }),
    WeatherCapacityAdjustment.findAll({
      where: {
        arrivalId: schedule.mateId,
        departureId: schedule.terminalId,
      },
    }),
  ]);
  const forecastsByHour = new Map<number, WeatherConditions>();
  // forecast rows
  forecasts.forEach((forecast) => {
    forecastsByHour.set(forecast.forecastFor, mapForecastWeather(forecast));
  });
  const adjustmentsByBucket = new Map<string, WeatherAdjustmentRule[]>();
  // adjustment rows
  adjustments.forEach((adjustment) => {
    const rules = adjustmentsByBucket.get(adjustment.weatherBucket) ?? [];
    adjustmentsByBucket.set(adjustment.weatherBucket, [
      ...rules,
      mapAdjustmentRule(adjustment),
    ]);
  });
  return { adjustmentsByBucket, forecastsByHour };
};

// load uncached forecast
const loadForecastWeather = async (
  terminalId: string,
  forecastFor: number
): Promise<WeatherConditions | null> => {
  const forecast = await WeatherForecast.findOne({
    where: {
      forecastFor,
      terminalId,
    },
  });
  // missing forecast guard
  if (!forecast) {
    return null;
  }
  return mapForecastWeather(forecast);
};

// load uncached adjustments
const loadAdjustmentRules = async (
  schedule: Schedule,
  buckets: string[]
): Promise<WeatherAdjustmentRule[]> => {
  const adjustments = await WeatherCapacityAdjustment.findAll({
    where: {
      arrivalId: schedule.mateId,
      departureId: schedule.terminalId,
      weatherBucket: { [Op.in]: buckets },
    },
  });
  return adjustments.map(mapAdjustmentRule);
};

// get context rules
const getContextAdjustmentRules = (
  context: WeatherAdjustmentContext,
  buckets: string[]
): WeatherAdjustmentRule[] =>
  buckets.flatMap((bucket) => context.adjustmentsByBucket.get(bucket) ?? []);

// load weather-adjusted capacity
export const getWeatherAdjustedCapacity = async ({
  capacity,
  context,
  liveCapacity,
  schedule,
  slotTime,
  terminal,
}: GetWeatherAdjustedCapacityInput): Promise<CapacityPair> => {
  // missing terminal guard
  if (!terminal) {
    return capacity;
  }
  const forecastFor = slotTime.startOf("hour").toSeconds();
  const weather =
    context?.forecastsByHour.get(forecastFor) ??
    (await loadForecastWeather(schedule.terminalId, forecastFor));
  // missing forecast guard
  if (!weather) {
    return capacity;
  }
  const buckets = getWeatherBuckets(weather);
  const adjustments = context
    ? getContextAdjustmentRules(context, buckets)
    : await loadAdjustmentRules(schedule, buckets);
  // missing adjustment guard
  if (!adjustments.length) {
    return capacity;
  }
  return applyWeatherAdjustment({
    capacity,
    liveCapacity,
    rules: adjustments,
  });
};
