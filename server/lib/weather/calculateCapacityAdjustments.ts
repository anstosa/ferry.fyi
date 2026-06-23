import logger from "heroku-logger";
import { DateTime } from "luxon";
import { Op, QueryTypes } from "sequelize";
import { round } from "shared/lib/math";

import { db } from "~/lib/db";
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

interface HistoricalCapacityCrossing {
  arrivalId: string;
  departureId: string;
  departureTime: number;
  driveUpCapacity: number;
  reservableCapacity: number | null;
}

interface HistoricalWeatherObservation {
  cloudCoverPercent: number | null;
  observedAt: number;
  precipitationMm: number | null;
  temperatureC: number | null;
  terminalId: string;
  windSpeedKmh: number | null;
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

interface PersistedWeatherAdjustmentCount {
  rowsWritten: number;
}

// build observation key
const getObservationKey = (terminalId: string, observedAt: number): string =>
  [terminalId, observedAt].join("::");

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
  crossings: HistoricalCapacityCrossing[]
): Map<
  string,
  {
    driveUpCapacity: number;
    reservableCapacity: number;
  }
> => {
  const grouped = new Map<string, HistoricalCapacityCrossing[]>();
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
  const crossings = (await Crossing.findAll({
    attributes: [
      "arrivalId",
      "departureId",
      "departureTime",
      "driveUpCapacity",
      "reservableCapacity",
    ],
    raw: true,
    where: { isCancelled: false },
  })) as unknown as HistoricalCapacityCrossing[];
  const baselines = getRouteBaselines(crossings);
  const crossingHours = crossings.map((crossing) => ({
    crossing,
    observedAt: DateTime.fromSeconds(crossing.departureTime)
      .setZone("America/Los_Angeles")
      .startOf("hour")
      .toSeconds(),
  }));
  const departureIds = Array.from(
    new Set(crossingHours.map(({ crossing }) => crossing.departureId))
  );
  const observedHours = Array.from(
    new Set(crossingHours.map(({ observedAt }) => observedAt))
  );
  // empty inputs guard
  if (!departureIds.length || !observedHours.length) {
    return [];
  }
  const observations = (await WeatherObservation.findAll({
    attributes: [
      "cloudCoverPercent",
      "observedAt",
      "precipitationMm",
      "temperatureC",
      "terminalId",
      "windSpeedKmh",
    ],
    raw: true,
    where: {
      observedAt: { [Op.in]: observedHours },
      terminalId: { [Op.in]: departureIds },
    },
  })) as unknown as HistoricalWeatherObservation[];
  const observationsByKey = new Map(
    observations.map((observation) => [
      getObservationKey(observation.terminalId, observation.observedAt),
      observation,
    ])
  );
  const samples: HistoricalWeatherSample[] = [];
  // crossing rows
  for (const { crossing, observedAt } of crossingHours) {
    const observation = observationsByKey.get(
      getObservationKey(crossing.departureId, observedAt)
    );
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
  // empty rows guard
  if (rows.length === 0) {
    return 0;
  }
  await WeatherCapacityAdjustment.bulkCreate(
    rows.map((row) => ({
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
    })),
    {
      conflictAttributes: [
        "departureId",
        "arrivalId",
        "weatherBucket",
        "capacityType",
      ],
      updateOnDuplicate: [
        "adjustmentSpaces",
        "calculatedAt",
        "effectSize",
        "isEnabled",
        "maxAdjustmentSpaces",
        "sampleSize",
        "updatedAt",
      ],
    }
  );
  return rows.length;
};

// calculate and persist adjustments
export const calculateAndPersistWeatherAdjustments = async (): Promise<{
  rowsCalculated: number;
  rowsWritten: number;
}> => {
  const [result] = await db.query<PersistedWeatherAdjustmentCount>(
    `
      WITH route_baselines AS (
        SELECT
          "departureId",
          "arrivalId",
          ROUND(AVG(COALESCE("driveUpCapacity", 0))) AS "baselineDriveUpCapacity",
          ROUND(AVG(COALESCE("reservableCapacity", 0))) AS "baselineReservableCapacity"
        FROM "Crossings"
        WHERE "isCancelled" = false
        GROUP BY "departureId", "arrivalId"
      ), samples AS (
        SELECT
          c."departureId",
          c."arrivalId",
          COALESCE(c."driveUpCapacity", 0) - b."baselineDriveUpCapacity" AS "driveUpResidual",
          COALESCE(c."reservableCapacity", 0) - b."baselineReservableCapacity" AS "reservableResidual",
          o."cloudCoverPercent",
          o."precipitationMm",
          o."temperatureC",
          o."windSpeedKmh"
        FROM "Crossings" c
        INNER JOIN route_baselines b
          ON b."departureId" = c."departureId"
          AND b."arrivalId" = c."arrivalId"
        INNER JOIN "WeatherObservations" o
          ON o."terminalId" = c."departureId"::text
          AND o."observedAt" = (FLOOR(c."departureTime" / 3600.0) * 3600)::integer
        WHERE c."isCancelled" = false
      ), bucketed AS (
        SELECT
          samples."departureId",
          samples."arrivalId",
          buckets."weatherBucket",
          capacity."capacityType",
          capacity."residual"
        FROM samples
        CROSS JOIN LATERAL (
          VALUES
            (CASE
              WHEN samples."precipitationMm" IS NULL THEN 'precipitation:unknown'
              WHEN samples."precipitationMm" <= 0 THEN 'precipitation:none'
              WHEN samples."precipitationMm" < 2.5 THEN 'precipitation:light'
              ELSE 'precipitation:moderate-heavy'
            END),
            (CASE
              WHEN samples."windSpeedKmh" IS NULL THEN 'wind:unknown'
              WHEN samples."windSpeedKmh" < 15 THEN 'wind:calm'
              WHEN samples."windSpeedKmh" < 35 THEN 'wind:breezy'
              ELSE 'wind:windy'
            END),
            (CASE
              WHEN samples."cloudCoverPercent" IS NULL THEN 'cloud:unknown'
              WHEN samples."cloudCoverPercent" < 25 THEN 'cloud:clear'
              WHEN samples."cloudCoverPercent" < 75 THEN 'cloud:mixed'
              ELSE 'cloud:overcast'
            END),
            (CASE
              WHEN samples."temperatureC" IS NULL THEN 'temperature:unknown'
              WHEN samples."temperatureC" < 8 THEN 'temperature:cold'
              WHEN samples."temperatureC" < 22 THEN 'temperature:mild'
              ELSE 'temperature:warm'
            END)
        ) AS buckets("weatherBucket")
        CROSS JOIN LATERAL (
          VALUES
            ('driveUp', samples."driveUpResidual"),
            ('reservable', samples."reservableResidual")
        ) AS capacity("capacityType", "residual")
      ), aggregated AS (
        SELECT
          "departureId",
          "arrivalId",
          "weatherBucket",
          "capacityType",
          ROUND(AVG("residual")) AS "adjustmentSpaces",
          ROUND(AVG(ABS("residual"))::numeric, 2)::float AS "effectSize",
          COUNT(*)::integer AS "sampleSize"
        FROM bucketed
        GROUP BY "departureId", "arrivalId", "weatherBucket", "capacityType"
      ), calculated AS (
        SELECT
          "departureId",
          "arrivalId",
          "weatherBucket",
          "capacityType",
          "adjustmentSpaces",
          "effectSize",
          "sampleSize",
          LEAST(
            GREATEST(ABS("adjustmentSpaces"), :minEffectSpaces),
            :globalMaxWeatherAdjustmentSpaces
          ) AS "maxAdjustmentSpaces",
          "sampleSize" >= :minAdjustmentSampleSize
            AND ABS("adjustmentSpaces") >= :minEffectSpaces AS "isEnabled"
        FROM aggregated
      ), inserted AS (
        INSERT INTO "WeatherCapacityAdjustments" (
          "departureId",
          "arrivalId",
          "weatherBucket",
          "capacityType",
          "adjustmentSpaces",
          "sampleSize",
          "effectSize",
          "maxAdjustmentSpaces",
          "isEnabled",
          "calculatedAt",
          "createdAt",
          "updatedAt"
        )
        SELECT
          "departureId",
          "arrivalId",
          "weatherBucket",
          "capacityType",
          "adjustmentSpaces",
          "sampleSize",
          "effectSize",
          "maxAdjustmentSpaces",
          "isEnabled",
          EXTRACT(EPOCH FROM NOW())::integer,
          NOW(),
          NOW()
        FROM calculated
        ON CONFLICT ("departureId", "arrivalId", "weatherBucket", "capacityType")
        DO UPDATE SET
          "adjustmentSpaces" = EXCLUDED."adjustmentSpaces",
          "sampleSize" = EXCLUDED."sampleSize",
          "effectSize" = EXCLUDED."effectSize",
          "maxAdjustmentSpaces" = EXCLUDED."maxAdjustmentSpaces",
          "isEnabled" = EXCLUDED."isEnabled",
          "calculatedAt" = EXCLUDED."calculatedAt",
          "updatedAt" = EXCLUDED."updatedAt"
        RETURNING 1
      )
      SELECT COUNT(*)::integer AS "rowsWritten" FROM inserted;
    `,
    {
      replacements: {
        globalMaxWeatherAdjustmentSpaces: GLOBAL_MAX_WEATHER_ADJUSTMENT_SPACES,
        minAdjustmentSampleSize: MIN_ADJUSTMENT_SAMPLE_SIZE,
        minEffectSpaces: MIN_EFFECT_SPACES,
      },
      type: QueryTypes.SELECT,
    }
  );
  const rowsWritten = result?.rowsWritten ?? 0;
  logger.info(`Calculated ${rowsWritten} weather capacity adjustment rows`);
  return { rowsCalculated: rowsWritten, rowsWritten };
};
