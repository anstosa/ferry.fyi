import { DateTime } from "luxon";

import logger from "~/lib/logger";
import { formatLogBlock, formatTerminalName } from "~/lib/logging";
import { Terminal } from "~/models/Terminal";
import { WeatherForecast } from "~/models/WeatherForecast";

import { toRequiredISODate } from "./dates";
import { fetchForecastWeather } from "./openMeteo";

type ForecastWeatherRecord = Awaited<
  ReturnType<typeof fetchForecastWeather>
>[number];

interface UpdateWeatherForecastsInput {
  fetchWeather?: typeof fetchForecastWeather;
  force?: boolean;
  now?: DateTime;
  ttlHours?: number;
}

export interface UpdateWeatherForecastsReport {
  recordsWritten: number;
  skipped: boolean;
}

const DEFAULT_FORECAST_DAYS = 16;
const DEFAULT_TTL_HOURS = 3;
let lastRefreshAt: DateTime | null = null;
let inFlightRefresh: Promise<UpdateWeatherForecastsReport> | null = null;

// reset forecast refresh state
export const resetWeatherForecastRefreshState = (): void => {
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
  records: Awaited<ReturnType<typeof fetchForecastWeather>>
): Promise<number> => {
  const recordsByKey = new Map<string, ForecastWeatherRecord>();
  // dedupe provider hours
  records.forEach((record) => {
    recordsByKey.set(`${terminalId}:${record.time}:${record.provider}`, record);
  });
  const uniqueRecords = Array.from(recordsByKey.values());
  await WeatherForecast.bulkCreate(
    uniqueRecords.map((record) => ({
      cloudCoverPercent: record.cloudCoverPercent,
      fetchedAt,
      forecastFor: record.time,
      latitude: record.latitude,
      longitude: record.longitude,
      precipitationMm: record.precipitationMm,
      provider: record.provider,
      temperatureC: record.temperatureC,
      timezone: record.timezone,
      terminalId,
      windGustKmh: record.windGustKmh,
      windSpeedKmh: record.windSpeedKmh,
    })),
    {
      conflictAttributes: ["terminalId", "forecastFor", "provider"],
      updateOnDuplicate: [
        "cloudCoverPercent",
        "fetchedAt",
        "latitude",
        "longitude",
        "precipitationMm",
        "temperatureC",
        "timezone",
        "windGustKmh",
        "windSpeedKmh",
        "updatedAt",
      ],
    }
  );
  return uniqueRecords.length;
};

// run forecast refresh
const runWeatherForecastRefresh = async ({
  fetchWeather = fetchForecastWeather,
  force = false,
  now = DateTime.local().setZone("America/Los_Angeles"),
  ttlHours = DEFAULT_TTL_HOURS,
}: UpdateWeatherForecastsInput): Promise<UpdateWeatherForecastsReport> => {
  // ttl guard
  if (shouldSkipRefresh(now, ttlHours, force)) {
    return { recordsWritten: 0, skipped: true };
  }
  const startDate = toRequiredISODate(now);
  const endDate = toRequiredISODate(
    now.plus({ days: DEFAULT_FORECAST_DAYS - 1 })
  );
  const fetchedAt = now.toSeconds();
  const terminals = Object.values(Terminal.getAll());
  const terminalResults = await Promise.all(
    terminals.map(async (terminal) => {
      let recordsWritten = 0;
      // provider failure guard
      try {
        const records = await fetchWeather({
          endDate,
          latitude: terminal.location.latitude,
          longitude: terminal.location.longitude,
          startDate,
        });
        // empty payload guard
        if (records.length === 0) {
          logger.error(
            formatLogBlock("Weather forecast refresh returned no records", [
              {
                heading: "summary",
                lines: [`terminal: ${formatTerminalName(terminal.id)}`],
              },
            ])
          );
          return { recordsWritten, succeeded: false };
        }
        recordsWritten += await upsertForecasts(
          terminal.id,
          fetchedAt,
          records
        );
        logger.info(
          formatLogBlock("Weather forecast update complete", [
            {
              heading: "summary",
              lines: [
                `terminal: ${formatTerminalName(terminal.id)}`,
                `hours: ${records.length}`,
              ],
            },
          ])
        );
        return { recordsWritten, succeeded: true };
      } catch (error) {
        // preserve refresh evidence
        logger.error(
          formatLogBlock("Weather forecast refresh failed", [
            {
              heading: "summary",
              lines: [
                `terminal: ${formatTerminalName(terminal.id)}`,
                `error: ${error instanceof Error ? error.message : String(error)}`,
              ],
            },
          ])
        );
        return { recordsWritten, succeeded: false };
      }
    })
  );
  const recordsWritten = terminalResults.reduce(
    (total, result) => total + result.recordsWritten,
    0
  );
  const allTerminalsSucceeded =
    terminalResults.length > 0 &&
    terminalResults.every((result) => result.succeeded);
  // successful refresh guard
  if (allTerminalsSucceeded) {
    lastRefreshAt = now;
  }
  return { recordsWritten, skipped: false };
};

// update weather forecasts
export const updateWeatherForecasts = async (
  input: UpdateWeatherForecastsInput = {}
): Promise<UpdateWeatherForecastsReport> => {
  // in-flight guard
  if (inFlightRefresh) {
    return inFlightRefresh;
  }
  const refresh = runWeatherForecastRefresh(input);
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
