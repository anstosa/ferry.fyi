import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const crossingModel = vi.hoisted(() => ({
  max: vi.fn(),
  min: vi.fn(),
}));

const terminalModel = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

const observationModel = vi.hoisted(() => ({
  upsert: vi.fn(),
}));

const forecastModel = vi.hoisted(() => ({
  upsert: vi.fn(),
}));

vi.mock("heroku-logger", () => ({
  default: { error: vi.fn(), info: vi.fn() },
}));

vi.mock("~/models/Crossing", () => ({
  default: crossingModel,
}));

vi.mock("~/models/Terminal", () => ({
  Terminal: terminalModel,
}));

vi.mock("~/models/WeatherObservation", () => ({
  WeatherObservation: observationModel,
}));

vi.mock("~/models/WeatherForecast", () => ({
  WeatherForecast: forecastModel,
}));

const { backfillWeatherObservations, createDateChunks } = await import(
  "../../server/lib/weather/backfill"
);
const { resetWeatherForecastRefreshState, updateWeatherForecasts } = await import(
  "../../server/lib/weather/updateForecasts"
);

const toSeconds = (input: string): number =>
  DateTime.fromISO(input, { zone: "America/Los_Angeles" }).toSeconds();

const terminal = {
  id: "1",
  location: {
    latitude: 47.6,
    longitude: -122.3,
  },
};

const mateTerminal = {
  id: "2",
  location: {
    latitude: 47.9,
    longitude: -122.6,
  },
};

const weatherRecord = {
  cloudCoverPercent: 80,
  latitude: 47.6,
  longitude: -122.3,
  timezone: "America/Los_Angeles",
  precipitationMm: 1,
  provider: "open-meteo",
  temperatureC: 12,
  time: toSeconds("2026-06-01T12:00:00"),
  windSpeedKmh: 20,
};

describe("weather ingestion", () => {
  beforeEach(() => {
    crossingModel.max.mockReset();
    crossingModel.min.mockReset();
    terminalModel.getAll.mockReset();
    observationModel.upsert.mockReset();
    forecastModel.upsert.mockReset();
    resetWeatherForecastRefreshState();
    terminalModel.getAll.mockReturnValue({ [terminal.id]: terminal });
  });

  // chunk behavior
  it("creates inclusive date chunks", () => {
    const chunks = createDateChunks(
      DateTime.fromISO("2026-06-01"),
      DateTime.fromISO("2026-06-05"),
      2
    );

    expect(chunks).toEqual([
      { endDate: "2026-06-02", startDate: "2026-06-01" },
      { endDate: "2026-06-04", startDate: "2026-06-03" },
      { endDate: "2026-06-05", startDate: "2026-06-05" },
    ]);
  });

  // dry-run behavior
  it("dry-runs backfill chunks without writing observations", async () => {
    crossingModel.min.mockResolvedValue(toSeconds("2026-06-01T05:00:00"));
    crossingModel.max.mockResolvedValue(toSeconds("2026-06-03T05:00:00"));

    const report = await backfillWeatherObservations({ dryRun: true });

    expect(report.chunks).toHaveLength(1);
    expect(report.recordsWritten).toBe(0);
    expect(observationModel.upsert).not.toHaveBeenCalled();
  });

  // upsert behavior
  it("upserts fetched weather observations", async () => {
    crossingModel.min.mockResolvedValue(toSeconds("2026-06-01T05:00:00"));
    crossingModel.max.mockResolvedValue(toSeconds("2026-06-01T05:00:00"));

    const report = await backfillWeatherObservations({
      fetchWeather: vi.fn().mockResolvedValue([weatherRecord]),
    });

    expect(report.recordsWritten).toBe(1);
    expect(observationModel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ observedAt: weatherRecord.time, terminalId: "1" })
    );
  });

  // ttl behavior
  it("does not fetch forecasts again inside the refresh TTL", async () => {
    const fetchWeather = vi.fn().mockResolvedValue([weatherRecord]);
    const now = DateTime.fromISO("2026-06-01T09:00:00", {
      zone: "America/Los_Angeles",
    });

    const first = await updateWeatherForecasts({ fetchWeather, now, ttlHours: 3 });
    const second = await updateWeatherForecasts({
      fetchWeather,
      now: now.plus({ hours: 1 }),
      ttlHours: 3,
    });

    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    expect(forecastModel.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ forecastFor: weatherRecord.time, terminalId: "1" })
    );
  });

  // provider failure behavior
  it("does not block refreshes when weather forecast fetch fails", async () => {
    const fetchWeather = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce([weatherRecord]);
    const now = DateTime.fromISO("2026-06-01T09:00:00", {
      zone: "America/Los_Angeles",
    });

    const report = await updateWeatherForecasts({
      fetchWeather,
      now: DateTime.fromISO("2026-06-01T09:00:00", {
        zone: "America/Los_Angeles",
      }),
    });
    const retry = await updateWeatherForecasts({
      fetchWeather,
      now: now.plus({ minutes: 1 }),
    });

    expect(report).toEqual({ recordsWritten: 0, skipped: false });
    expect(retry).toEqual({ recordsWritten: 1, skipped: false });
    expect(fetchWeather).toHaveBeenCalledTimes(2);
  });

  // partial failure behavior
  it("retries after any terminal forecast fetch fails", async () => {
    terminalModel.getAll.mockReturnValue({
      [mateTerminal.id]: mateTerminal,
      [terminal.id]: terminal,
    });
    const fetchWeather = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValue([weatherRecord]);
    const now = DateTime.fromISO("2026-06-01T09:00:00", {
      zone: "America/Los_Angeles",
    });

    const report = await updateWeatherForecasts({ fetchWeather, now });
    const retry = await updateWeatherForecasts({
      fetchWeather,
      now: now.plus({ minutes: 1 }),
    });

    expect(report).toEqual({ recordsWritten: 1, skipped: false });
    expect(retry).toEqual({ recordsWritten: 2, skipped: false });
    expect(fetchWeather).toHaveBeenCalledTimes(4);
  });

  // empty payload behavior
  it("retries after a terminal forecast fetch returns no rows", async () => {
    const fetchWeather = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([weatherRecord]);
    const now = DateTime.fromISO("2026-06-01T09:00:00", {
      zone: "America/Los_Angeles",
    });

    const report = await updateWeatherForecasts({ fetchWeather, now });
    const retry = await updateWeatherForecasts({
      fetchWeather,
      now: now.plus({ minutes: 1 }),
    });

    expect(report).toEqual({ recordsWritten: 0, skipped: false });
    expect(retry).toEqual({ recordsWritten: 1, skipped: false });
    expect(fetchWeather).toHaveBeenCalledTimes(2);
  });

  // persistence failure behavior
  it("retries after weather forecast persistence fails", async () => {
    const fetchWeather = vi.fn().mockResolvedValue([weatherRecord]);
    forecastModel.upsert
      .mockRejectedValueOnce(new Error("db busy"))
      .mockResolvedValueOnce(undefined);
    const now = DateTime.fromISO("2026-06-01T09:00:00", {
      zone: "America/Los_Angeles",
    });

    const report = await updateWeatherForecasts({ fetchWeather, now });
    const retry = await updateWeatherForecasts({
      fetchWeather,
      now: now.plus({ minutes: 1 }),
    });

    expect(report).toEqual({ recordsWritten: 0, skipped: false });
    expect(retry).toEqual({ recordsWritten: 1, skipped: false });
    expect(fetchWeather).toHaveBeenCalledTimes(2);
  });
});
