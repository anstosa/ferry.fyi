import logger from "heroku-logger";
import { DateTime } from "luxon";
import { round } from "shared/lib/math";

import Crossing from "~/models/Crossing";
import { WeatherCapacityAdjustment } from "~/models/WeatherCapacityAdjustment";
import { WeatherObservation } from "~/models/WeatherObservation";

import {
  CapacityType,
  getWeatherBuckets,
  GLOBAL_MAX_WEATHER_ADJUSTMENT_SPACES,
  MIN_ADJUSTMENT_SAMPLE_SIZE,
  WeatherConditions,
} from "./capacityAdjustment";

interface HistoricalWeatherSample {
  arrivalId: string;
  baselineDriveUpCapacity: number;
  baselineReservableCapacity: number;
  departureId: string;
  driveUpCapacity: number;
  reservableCapacity: number;
  weather: WeatherConditions;
}

export interface CalculatedWeatherAdjustment {
  adjustmentSpaces: number;
  arrivalId: string;
  capacityType: CapacityType;
  departureId: string;
  effectSize: number;
  isEnabled: boolean;
  maxAdjustmentSpaces: number;
  sampleSize: number;
  weatherBucket: string;
}

const MIN_EFFECT_SPACES = 3;

// build group key
const getAdjustmentKey = (
  sample: HistoricalWeatherSample,
  bucket: string,
  capacityType: CapacityType
): string =>
  [sample.departureId, sample.arrivalId, bucket, capacityType].join("::");

// parse group key
const parseAdjustmentKey = (
  key: string
): {
  arrivalId: string;
  capacityType: CapacityType;
  departureId: string;
  weatherBucket: string;
} => {
  const [departureId, arrivalId, weatherBucket, capacityType] = key.split("::");
  return {
    arrivalId,
    capacityType: capacityType as CapacityType,
    departureId,
    weatherBucket,
  };
};

// average numbers
const mean = (values: number[]): number => {
  // empty guard
  if (!values.length) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
};

// calculate adjustment rows
export const calculateWeatherAdjustmentRows = (
  samples: HistoricalWeatherSample[]
): CalculatedWeatherAdjustment[] => {
  const grouped = new Map<string, number[]>();
  // sample rows
  samples.forEach((sample) => {
    const buckets = getWeatherBuckets(sample.weather);
    // weather buckets
    buckets.forEach((bucket) => {
      const driveUpKey = getAdjustmentKey(sample, bucket, "driveUp");
      const reservableKey = getAdjustmentKey(sample, bucket, "reservable");
      grouped.set(driveUpKey, [
        ...(grouped.get(driveUpKey) ?? []),
        sample.driveUpCapacity - sample.baselineDriveUpCapacity,
      ]);
      grouped.set(reservableKey, [
        ...(grouped.get(reservableKey) ?? []),
        sample.reservableCapacity - sample.baselineReservableCapacity,
      ]);
    });
  });

  return Array.from(grouped.entries()).map(([key, residuals]) => {
    const parsed = parseAdjustmentKey(key);
    const adjustmentSpaces = round(mean(residuals));
    const effectSize = round(
      mean(residuals.map((value) => Math.abs(value))),
      2
    );
    const sampleSize = residuals.length;
    const maxAdjustmentSpaces = Math.min(
      Math.max(Math.abs(adjustmentSpaces), MIN_EFFECT_SPACES),
      GLOBAL_MAX_WEATHER_ADJUSTMENT_SPACES
    );
    const isEnabled =
      sampleSize >= MIN_ADJUSTMENT_SAMPLE_SIZE &&
      Math.abs(adjustmentSpaces) >= MIN_EFFECT_SPACES;
    return {
      ...parsed,
      adjustmentSpaces,
      effectSize,
      isEnabled,
      maxAdjustmentSpaces,
      sampleSize,
    };
  });
};

// build route baseline map
const getRouteBaselines = (
  crossings: Crossing[]
): Map<
  string,
  {
    driveUpCapacity: number;
    reservableCapacity: number;
  }
> => {
  const grouped = new Map<string, Crossing[]>();
  // route crossings
  crossings.forEach((crossing) => {
    const key = [crossing.departureId, crossing.arrivalId].join("::");
    grouped.set(key, [...(grouped.get(key) ?? []), crossing]);
  });
  const baselines = new Map<
    string,
    { driveUpCapacity: number; reservableCapacity: number }
  >();
  // route groups
  grouped.forEach((routeCrossings, key) => {
    baselines.set(key, {
      driveUpCapacity: round(
        mean(routeCrossings.map((crossing) => crossing.driveUpCapacity))
      ),
      reservableCapacity: round(
        mean(routeCrossings.map((crossing) => crossing.reservableCapacity ?? 0))
      ),
    });
  });
  return baselines;
};

// load historical samples
export const loadHistoricalWeatherSamples = async (): Promise<
  HistoricalWeatherSample[]
> => {
  const crossings = await Crossing.findAll({
    where: { isCancelled: false },
  });
  const baselines = getRouteBaselines(crossings);
  const samples: HistoricalWeatherSample[] = [];
  // crossing rows
  for (const crossing of crossings) {
    const observedAt = DateTime.fromSeconds(crossing.departureTime)
      .setZone("America/Los_Angeles")
      .startOf("hour")
      .toSeconds();
    const observation = await WeatherObservation.findOne({
      where: {
        observedAt,
        terminalId: crossing.departureId,
      },
    });
    // missing observation guard
    if (!observation) {
      continue;
    }
    const baseline = baselines.get(
      [crossing.departureId, crossing.arrivalId].join("::")
    );
    // missing baseline guard
    if (!baseline) {
      continue;
    }
    samples.push({
      arrivalId: crossing.arrivalId,
      baselineDriveUpCapacity: baseline.driveUpCapacity,
      baselineReservableCapacity: baseline.reservableCapacity,
      departureId: crossing.departureId,
      driveUpCapacity: crossing.driveUpCapacity,
      reservableCapacity: crossing.reservableCapacity ?? 0,
      weather: {
        cloudCoverPercent: observation.cloudCoverPercent,
        precipitationMm: observation.precipitationMm,
        temperatureC: observation.temperatureC,
        windSpeedKmh: observation.windSpeedKmh,
      },
    });
  }
  return samples;
};

// persist adjustment rows
export const persistWeatherAdjustmentRows = async (
  rows: CalculatedWeatherAdjustment[],
  calculatedAt = DateTime.local().toSeconds()
): Promise<number> => {
  let rowsWritten = 0;
  // adjustment rows
  for (const row of rows) {
    await WeatherCapacityAdjustment.upsert({
      adjustmentSpaces: row.adjustmentSpaces,
      arrivalId: row.arrivalId,
      calculatedAt,
      capacityType: row.capacityType,
      departureId: row.departureId,
      effectSize: row.effectSize,
      isEnabled: row.isEnabled,
      maxAdjustmentSpaces: row.maxAdjustmentSpaces,
      sampleSize: row.sampleSize,
      weatherBucket: row.weatherBucket,
    });
    rowsWritten += 1;
  }
  return rowsWritten;
};

// calculate and persist adjustments
export const calculateAndPersistWeatherAdjustments = async (): Promise<{
  rowsCalculated: number;
  rowsWritten: number;
}> => {
  const samples = await loadHistoricalWeatherSamples();
  const rows = calculateWeatherAdjustmentRows(samples);
  const rowsWritten = await persistWeatherAdjustmentRows(rows);
  logger.info(`Calculated ${rows.length} weather capacity adjustment rows`);
  return { rowsCalculated: rows.length, rowsWritten };
};
