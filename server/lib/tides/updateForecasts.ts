import logger from "heroku-logger";
import { DateTime } from "luxon";

import { formatLogBlock, formatTerminalList } from "~/lib/logging";
import { TideForecast } from "~/models/TideForecast";

import { toRequiredISODate } from "../weather/dates";
import { fetchTidePredictions, NoaaTideRecord } from "./noaa";
import { getTideTargets, groupTideTargetsByStation } from "./stations";

interface UpdateTideForecastsInput {
  fetchTides?: typeof fetchTidePredictions;
  force?: boolean;
  now?: DateTime;
  ttlHours?: number;
}

export interface UpdateTideForecastsReport {
  recordsWritten: number;
  skipped: boolean;
}

const DEFAULT_FORECAST_DAYS = 16;
const DEFAULT_TTL_HOURS = 3;
let lastRefreshAt: DateTime | null = null;
let inFlightRefresh: Promise<UpdateTideForecastsReport> | null = null;

// reset forecast refresh state
export const resetTideForecastRefreshState = (): void => {
  lastRefreshAt = null;
  inFlightRefresh = null;
};

// should skip refresh
const shouldSkipRefresh = (
  now: DateTime,
  ttlHours: number,
  force: boolean
): boolean => {
  // forced refresh guard
  if (force) {
    return false;
  }
  // missing refresh guard
  if (!lastRefreshAt) {
    return false;
  }
  return now.diff(lastRefreshAt, "hours").hours < ttlHours;
};

// upsert forecasts
const upsertForecasts = async (
  terminalId: string,
  fetchedAt: number,
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
  await TideForecast.bulkCreate(
    uniqueRecords.map((record) => ({
      datum: record.datum,
      fetchedAt,
      forecastFor: record.time,
      provider: record.provider,
      stationId: record.stationId,
      terminalId,
      timezone: record.timezone,
      waterLevelM: record.waterLevelM,
    })),
    {
      conflictAttributes: ["terminalId", "forecastFor", "provider"],
      updateOnDuplicate: [
        "datum",
        "fetchedAt",
        "stationId",
        "timezone",
        "waterLevelM",
        "updatedAt",
      ],
    }
  );
  return uniqueRecords.length;
};

// run forecast refresh
const runTideForecastRefresh = async ({
  fetchTides = fetchTidePredictions,
  force = false,
  now = DateTime.local().setZone("America/Los_Angeles"),
  ttlHours = DEFAULT_TTL_HOURS,
}: UpdateTideForecastsInput): Promise<UpdateTideForecastsReport> => {
  // ttl guard
  if (shouldSkipRefresh(now, ttlHours, force)) {
    return { recordsWritten: 0, skipped: true };
  }
  const startDate = toRequiredISODate(now);
  const endDate = toRequiredISODate(
    now.plus({ days: DEFAULT_FORECAST_DAYS - 1 })
  );
  const fetchedAt = now.toSeconds();
  const stationGroups = Array.from(
    groupTideTargetsByStation(getTideTargets()).entries()
  );
  const stationResults = await Promise.all(
    stationGroups.map(async ([stationId, targets]) => {
      let recordsWritten = 0;
      // provider failure guard
      try {
        const records = await fetchTides({ endDate, startDate, stationId });
        // empty payload guard
        if (records.length === 0) {
          logger.error(
            formatLogBlock("Tide forecast refresh returned no records", [
              {
                heading: "summary",
                lines: [`station: ${stationId}`],
              },
              {
                heading: "terminals",
                lines: formatTerminalList(
                  targets.map((target) => target.terminalId)
                ),
              },
            ])
          );
          return { recordsWritten, succeeded: false };
        }
        const targetWrites = await Promise.all(
          targets.map((target) =>
            upsertForecasts(target.terminalId, fetchedAt, records)
          )
        );
        recordsWritten += targetWrites.reduce(
          (total, count) => total + count,
          0
        );
        logger.info(
          formatLogBlock("Tide forecast update complete", [
            {
              heading: "summary",
              lines: [`station: ${stationId}`, `hours: ${records.length}`],
            },
            {
              heading: "terminals",
              lines: formatTerminalList(
                targets.map((target) => target.terminalId)
              ),
            },
          ])
        );
        return { recordsWritten, succeeded: true };
      } catch (error) {
        // preserve refresh evidence
        logger.error(
          formatLogBlock("Tide forecast refresh failed", [
            {
              heading: "summary",
              lines: [
                `station: ${stationId}`,
                `error: ${error instanceof Error ? error.message : String(error)}`,
              ],
            },
            {
              heading: "terminals",
              lines: formatTerminalList(
                targets.map((target) => target.terminalId)
              ),
            },
          ])
        );
        return { recordsWritten, succeeded: false };
      }
    })
  );
  const recordsWritten = stationResults.reduce(
    (total, result) => total + result.recordsWritten,
    0
  );
  const allStationsSucceeded =
    stationResults.length > 0 &&
    stationResults.every((result) => result.succeeded);
  // successful refresh guard
  if (allStationsSucceeded) {
    lastRefreshAt = now;
  }
  return { recordsWritten, skipped: false };
};

// update tide forecasts
export const updateTideForecasts = async (
  input: UpdateTideForecastsInput = {}
): Promise<UpdateTideForecastsReport> => {
  // in-flight guard
  if (inFlightRefresh) {
    return inFlightRefresh;
  }
  const refresh = runTideForecastRefresh(input);
  inFlightRefresh = refresh;
  try {
    return await refresh;
  } finally {
    // matching refresh guard
    if (inFlightRefresh === refresh) {
      inFlightRefresh = null;
    }
  }
};
