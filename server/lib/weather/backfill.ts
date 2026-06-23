import logger from "heroku-logger";
import { DateTime } from "luxon";

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
}

const DEFAULT_CHUNK_DAYS = 14;

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

// upsert observation
const upsertObservation = async (
  terminalId: string,
  record: OpenMeteoWeatherRecord
): Promise<void> => {
  await WeatherObservation.upsert({
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
  });
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
    return { chunks: [], dryRun, recordsWritten: 0 };
  }
  const targets = getWeatherTargets();
  const dateChunks = createDateChunks(range.start, range.end, chunkDays);
  const chunks: BackfillChunk[] = [];
  let recordsWritten = 0;
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
      const records = await fetchWeather({
        endDate: chunk.endDate,
        latitude: target.latitude,
        longitude: target.longitude,
        startDate: chunk.startDate,
      });
      // weather records
      for (const record of records) {
        await upsertObservation(target.terminalId, record);
        recordsWritten += 1;
      }
      logger.info(
        `Backfilled ${records.length} weather hours for terminal ${target.terminalId} from ${chunk.startDate} to ${chunk.endDate}`
      );
    }
  }
  return { chunks, dryRun, recordsWritten };
};
