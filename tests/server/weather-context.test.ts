import { DateTime } from "luxon";
import { Op } from "sequelize";
import { describe, expect, it, vi } from "vitest";

import type { Schedule } from "~/models/Schedule";
import type { Terminal } from "~/models/Terminal";

const forecastModel = vi.hoisted(() => ({
  findAll: vi.fn(),
}));

const adjustmentModel = vi.hoisted(() => ({
  findAll: vi.fn(),
}));

vi.mock("~/models/WeatherForecast", () => ({
  WeatherForecast: forecastModel,
}));

vi.mock("~/models/WeatherCapacityAdjustment", () => ({
  WeatherCapacityAdjustment: adjustmentModel,
}));

const { createWeatherAdjustmentContext, MAX_WEATHER_FORECAST_AGE_HOURS } =
  await import("../../server/lib/weather/capacityAdjustment");

const schedule = {
  mateId: "2",
  terminalId: "1",
} as unknown as Schedule;

const terminal = {
  id: "1",
  location: {
    latitude: 47.6,
    longitude: -122.3,
  },
} as unknown as Terminal;

describe("weather adjustment context", () => {
  // freshness behavior
  it("only loads forecasts fetched inside the freshness window", async () => {
    const now = DateTime.fromISO("2026-06-01T09:00:00", {
      zone: "America/Los_Angeles",
    });
    forecastModel.findAll.mockResolvedValue([]);
    adjustmentModel.findAll.mockResolvedValue([]);

    await createWeatherAdjustmentContext({
      now,
      schedule,
      slotTimes: [now.plus({ hours: 1 })],
      terminal,
    });

    const where = forecastModel.findAll.mock.calls[0][0].where;
    expect(where.fetchedAt[Op.gte]).toBe(
      now.minus({ hours: MAX_WEATHER_FORECAST_AGE_HOURS }).toSeconds()
    );
  });
});
