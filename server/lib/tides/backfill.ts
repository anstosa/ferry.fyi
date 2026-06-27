import logger from "heroku-logger";
import { DateTime } from "luxon";
import { Op } from "sequelize";

import Crossing from "~/models/Crossing";
import { TideObservation } from "~/models/TideObservation";

import { toRequiredISODate } from "../weather/dates";
import { fetchTidePredictions, NoaaTideRecord } from "./noaa";
import { getTideTargets, groupTideTargetsByStation } from "./stations";

interface BackfillTidesInput {
  chunkDays?: number;
  dryRun?: boolean;
  fetchTides?: typeof fetchTidePredictions;
}

interface BackfillChunk {
  endDate: string;
  startDate: string;
  stationId: string;
  terminalIds: string[];
}

export interface BackfillTidesReport {
  chunks: BackfillChunk[];
  dryRun: boolean;
  recordsWritten: number;
  skippedChunks: number;
}

const DEFAULT_CHUNK_DAYS = 365;
const NOAA_TIDE_PROVIDER = "noaa-coops";
const TIDE_TIMEZONE = "America/Los_Angeles";

// load backfill range
export const getCrossingTideRange = async (): Promise<{
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
    end: DateTime.fromSeconds(newest).setZone(TIDE_TIMEZONE),
    start: DateTime.fromSeconds(oldest).setZone(TIDE_TIMEZONE),
  };
};

// create date chunks
export const createTideDateChunks = (
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
    zone: TIDE_TIMEZONE,
  }).startOf("day");
  const endExclusive = DateTime.fromISO(chunk.endDate, {
    zone: TIDE_TIMEZONE,
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
const countExistingTideHours = (
  terminalId: string,
  chunk: Pick<BackfillChunk, "endDate" | "startDate">
): Promise<number> => {
  const { endExclusive, start } = getChunkHourRange(chunk);
  return TideObservation.count({
    col: "observedAt",
    distinct: true,
    where: {
      observedAt: {
        [Op.gte]: start,
        [Op.lt]: endExclusive,
      },
      provider: NOAA_TIDE_PROVIDER,
      terminalId,
    },
  });
};

// find missing terminals
const getMissingTerminalsForChunk = async (
  terminalIds: string[],
  chunk: Pick<BackfillChunk, "endDate" | "startDate">
): Promise<string[]> => {
  const { expectedHours } = getChunkHourRange(chunk);
  const missingTerminalIds: string[] = [];
  // terminal coverage checks
  for (const terminalId of terminalIds) {
    const existingHours = await countExistingTideHours(terminalId, chunk);
    // incomplete terminal guard
    if (existingHours < expectedHours) {
      missingTerminalIds.push(terminalId);
    }
  }
  return missingTerminalIds;
};

// upsert observations
const upsertObservations = async (
  terminalId: string,
  records: NoaaTideRecord[]
): Promise<number> => {
  const recordsByKey = new Map<string, NoaaTideRecord>();
  // dedupe provider hours
  records.forEach((record) => {
    recordsByKey.set(`${terminalId}:${record.time}:${record.provider}`, record);
  });
  const uniqueRecords = Array.from(recordsByKey.values());
  // empty records guard
  if (uniqueRecords.length === 0) {
    return 0;
  }
  await TideObservation.bulkCreate(
    uniqueRecords.map((record) => ({
      datum: record.datum,
      observedAt: record.time,
      provider: record.provider,
      stationId: record.stationId,
      terminalId,
      timezone: record.timezone,
      waterLevelM: record.waterLevelM,
    })),
    {
      conflictAttributes: ["terminalId", "observedAt", "provider"],
      updateOnDuplicate: [
        "datum",
        "stationId",
        "timezone",
        "waterLevelM",
        "updatedAt",
      ],
    }
  );
  return uniqueRecords.length;
};

// backfill observations
export const backfillTideObservations = async ({
  chunkDays = DEFAULT_CHUNK_DAYS,
  dryRun = false,
  fetchTides = fetchTidePredictions,
}: BackfillTidesInput = {}): Promise<BackfillTidesReport> => {
  const range = await getCrossingTideRange();
  // missing range guard
  if (!range) {
    return { chunks: [], dryRun, recordsWritten: 0, skippedChunks: 0 };
  }
  const targetsByStation = groupTideTargetsByStation(getTideTargets());
  const dateChunks = createTideDateChunks(range.start, range.end, chunkDays);
  const chunks: BackfillChunk[] = [];
  let recordsWritten = 0;
  let skippedChunks = 0;
  // station chunks
  for (const [stationId, targets] of targetsByStation) {
    const terminalIds = targets.map((target) => target.terminalId);
    // date chunks
    for (const chunk of dateChunks) {
      chunks.push({ ...chunk, stationId, terminalIds });
      // dry-run guard
      if (dryRun) {
        continue;
      }
      const missingTerminalIds = await getMissingTerminalsForChunk(
        terminalIds,
        chunk
      );
      // existing chunk guard
      if (missingTerminalIds.length === 0) {
        skippedChunks += 1;
        logger.info(
          `Skipped existing tide hours for station ${stationId} from ${chunk.startDate} to ${chunk.endDate}`
        );
        continue;
      }
      const records = await fetchTides({
        endDate: chunk.endDate,
        startDate: chunk.startDate,
        stationId,
      });
      // missing terminal writes
      for (const terminalId of missingTerminalIds) {
        recordsWritten += await upsertObservations(terminalId, records);
      }
      logger.info(
        `Backfilled ${records.length} tide hours for station ${stationId} from ${chunk.startDate} to ${chunk.endDate}`
      );
    }
  }
  return { chunks, dryRun, recordsWritten, skippedChunks };
};
