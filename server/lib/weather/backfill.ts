import logger from "heroku-logger";
import { DateTime } from "luxon";
import { Op } from "sequelize";

import Crossing from "~/models/Crossing";
import { Terminal } from "~/models/Terminal";
import { WeatherObservation } from "~/models/WeatherObservation";

import { toRequiredISODate } from "./dates";
import {
  estimateOpenMeteoCallCost,
  fetchHistoricalWeather,
  OpenMeteoWeatherRecord,
} from "./openMeteo";

interface WeatherTarget {
  latitude: number;
  longitude: number;
  terminalId: string;
}

interface BackfillWeatherInput {
  chunkDays?: number;
  dryRun?: boolean;
  fetchWeather?: typeof fetchHistoricalWeather;
}

interface BackfillChunk {
  endDate: string;
  estimatedCallCost: number;
  startDate: string;
  terminalId: string;
}

export interface BackfillWeatherReport {
  chunks: BackfillChunk[];
  dryRun: boolean;
  recordsWritten: number;
  skippedChunks: number;
}

const DEFAULT_CHUNK_DAYS = 14;
const OPEN_METEO_PROVIDER = "open-meteo";
const WEATHER_TIMEZONE = "America/Los_Angeles";

// collect weather targets
export const getWeatherTargets = (): WeatherTarget[] =>
  Object.values(Terminal.getAll()).map((terminal) => ({
    latitude: terminal.location.latitude,
    longitude: terminal.location.longitude,
    terminalId: terminal.id,
  }));

// load backfill range
export const getCrossingWeatherRange = async (): Promise<{
  end: DateTime;
  start: DateTime;
} | null> => {
  const oldest = (await Crossing.min("departureTime")) as number | null;
  const newest = (await Crossing.max("departureTime")) as number | null;
  // missing crossing guard
  if (!oldest || !newest) {
    return null;
  }
  return {
    end: DateTime.fromSeconds(newest).setZone("America/Los_Angeles"),
    start: DateTime.fromSeconds(oldest).setZone("America/Los_Angeles"),
  };
};

// create date chunks
export const createDateChunks = (
  start: DateTime,
  end: DateTime,
  chunkDays = DEFAULT_CHUNK_DAYS
): Array<{ endDate: string; startDate: string }> => {
  const chunks: Array<{ endDate: string; startDate: string }> = [];
  let cursor = start.startOf("day");
  const finalDay = end.startOf("day");
  // walk date chunks
  while (cursor <= finalDay) {
    const chunkEnd = DateTime.min(
      cursor.plus({ days: chunkDays - 1 }),
      finalDay
    );
    chunks.push({
      endDate: toRequiredISODate(chunkEnd),
      startDate: toRequiredISODate(cursor),
    });
    cursor = chunkEnd.plus({ days: 1 });
  }
  return chunks;
};

// get chunk bounds
const getChunkHourRange = (
  chunk: Pick<BackfillChunk, "endDate" | "startDate">
): { endExclusive: number; expectedHours: number; start: number } => {
  const start = DateTime.fromISO(chunk.startDate, {
    zone: WEATHER_TIMEZONE,
  }).startOf("day");
  const endExclusive = DateTime.fromISO(chunk.endDate, {
    zone: WEATHER_TIMEZONE,
  })
    .plus({ days: 1 })
    .startOf("day");
  return {
    endExclusive: endExclusive.toSeconds(),
    expectedHours: Math.round(endExclusive.diff(start, "hours").hours),
    start: start.toSeconds(),
  };
};

// count existing hours
const countExistingWeatherHours = (
  terminalId: string,
  chunk: Pick<BackfillChunk, "endDate" | "startDate">
): Promise<number> => {
  const { endExclusive, start } = getChunkHourRange(chunk);
  return WeatherObservation.count({
    col: "observedAt",
    distinct: true,
    where: {
      observedAt: {
        [Op.gte]: start,
        [Op.lt]: endExclusive,
      },
      provider: OPEN_METEO_PROVIDER,
      terminalId,
    },
  });
};

// check chunk coverage
const hasExistingWeatherChunk = async (
  terminalId: string,
  chunk: Pick<BackfillChunk, "endDate" | "startDate">
): Promise<boolean> => {
  const { expectedHours } = getChunkHourRange(chunk);
  const existingHours = await countExistingWeatherHours(terminalId, chunk);
  return existingHours >= expectedHours;
};

// upsert observations
const upsertObservations = async (
  terminalId: string,
  records: OpenMeteoWeatherRecord[]
): Promise<number> => {
  const recordsByKey = new Map<string, OpenMeteoWeatherRecord>();
  // dedupe provider hours
  records.forEach((record) => {
    recordsByKey.set(`${terminalId}:${record.time}:${record.provider}`, record);
  });
  const uniqueRecords = Array.from(recordsByKey.values());
  // empty records guard
  if (uniqueRecords.length === 0) {
    return 0;
  }
  await WeatherObservation.bulkCreate(
    uniqueRecords.map((record) => ({
      cloudCoverPercent: record.cloudCoverPercent,
      latitude: record.latitude,
      longitude: record.longitude,
      observedAt: record.time,
      precipitationMm: record.precipitationMm,
      provider: record.provider,
      temperatureC: record.temperatureC,
      timezone: record.timezone,
      terminalId,
      windSpeedKmh: record.windSpeedKmh,
    })),
    {
      conflictAttributes: ["terminalId", "observedAt", "provider"],
      updateOnDuplicate: [
        "cloudCoverPercent",
        "latitude",
        "longitude",
        "precipitationMm",
        "temperatureC",
        "timezone",
        "windSpeedKmh",
        "updatedAt",
      ],
    }
  );
  return uniqueRecords.length;
};

// backfill observations
export const backfillWeatherObservations = async ({
  chunkDays = DEFAULT_CHUNK_DAYS,
  dryRun = false,
  fetchWeather = fetchHistoricalWeather,
}: BackfillWeatherInput = {}): Promise<BackfillWeatherReport> => {
  const range = await getCrossingWeatherRange();
  // missing range guard
  if (!range) {
    return { chunks: [], dryRun, recordsWritten: 0, skippedChunks: 0 };
  }
  const targets = getWeatherTargets();
  const dateChunks = createDateChunks(range.start, range.end, chunkDays);
  const chunks: BackfillChunk[] = [];
  let recordsWritten = 0;
  let skippedChunks = 0;
  // terminal chunks
  for (const target of targets) {
    // date chunks
    for (const chunk of dateChunks) {
      const estimatedCallCost = estimateOpenMeteoCallCost(
        DateTime.fromISO(chunk.endDate).diff(
          DateTime.fromISO(chunk.startDate),
          "days"
        ).days + 1
      );
      chunks.push({
        ...chunk,
        estimatedCallCost,
        terminalId: target.terminalId,
      });
      // dry-run guard
      if (dryRun) {
        continue;
      }
      // existing chunk guard
      if (await hasExistingWeatherChunk(target.terminalId, chunk)) {
        skippedChunks += 1;
        logger.info(
          `Skipped existing weather hours for terminal ${target.terminalId} from ${chunk.startDate} to ${chunk.endDate}`
        );
        continue;
      }
      const records = await fetchWeather({
        endDate: chunk.endDate,
        latitude: target.latitude,
        longitude: target.longitude,
        startDate: chunk.startDate,
      });
      recordsWritten += await upsertObservations(target.terminalId, records);
      logger.info(
        `Backfilled ${records.length} weather hours for terminal ${target.terminalId} from ${chunk.startDate} to ${chunk.endDate}`
      );
    }
  }
  return { chunks, dryRun, recordsWritten, skippedChunks };
};
