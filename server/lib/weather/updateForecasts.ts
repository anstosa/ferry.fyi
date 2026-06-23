import logger from "heroku-logger";
import { DateTime } from "luxon";

import { Terminal } from "~/models/Terminal";
import { WeatherForecast } from "~/models/WeatherForecast";

import { fetchForecastWeather } from "./openMeteo";

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

// upsert forecast
const upsertForecast = async (
  terminalId: string,
  fetchedAt: number,
  record: Awaited<ReturnType<typeof fetchForecastWeather>>[number]
): Promise<void> => {
  await WeatherForecast.upsert({
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
    windSpeedKmh: record.windSpeedKmh,
  });
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
  const startDate = now.toISODate() ?? "";
  const endDate =
    now.plus({ days: DEFAULT_FORECAST_DAYS - 1 }).toISODate() ?? "";
  const fetchedAt = now.toSeconds();
  let recordsWritten = 0;
  let successfulFetches = 0;
  // terminal forecasts
  for (const terminal of Object.values(Terminal.getAll())) {
    // provider failure guard
    try {
      const records = await fetchWeather({
        endDate,
        latitude: terminal.location.latitude,
        longitude: terminal.location.longitude,
        startDate,
      });
      // forecast records
      for (const record of records) {
        await upsertForecast(terminal.id, fetchedAt, record);
        recordsWritten += 1;
      }
      // persisted data guard
      if (records.length > 0) {
        successfulFetches += 1;
      }
      logger.info(
        `Updated ${records.length} weather forecast hours for ${terminal.id}`
      );
    } catch (error) {
      // preserve refresh evidence
      logger.error(
        `Weather forecast refresh failed for ${terminal.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
  // successful refresh guard
  if (successfulFetches > 0) {
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
