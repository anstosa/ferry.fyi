import { describe, expect, it, vi } from "vitest";

import {
  estimateOpenMeteoCallCost,
  fetchHistoricalWeather,
  getOpenMeteoArchiveUrl,
  normalizeOpenMeteoResponse,
} from "../../server/lib/weather/openMeteo";

describe("Open-Meteo weather provider", () => {
  // url behavior
  it("builds archive URLs with required hourly variables and units", () => {
    const url = new URL(
      getOpenMeteoArchiveUrl({
        endDate: "2026-06-02",
        latitude: 47.6,
        longitude: -122.3,
        startDate: "2026-06-01",
      })
    );

    expect(url.hostname).toBe("archive-api.open-meteo.com");
    expect(url.searchParams.get("hourly")).toBe(
      "temperature_2m,cloud_cover,wind_speed_10m,wind_gusts_10m,precipitation"
    );
    expect(url.searchParams.get("timezone")).toBe("America/Los_Angeles");
    expect(url.searchParams.get("wind_speed_unit")).toBe("kmh");
  });

  // mapping behavior
  it("normalizes hourly responses into weather records", () => {
    const records = normalizeOpenMeteoResponse({
      hourly: {
        cloud_cover: [90],
        precipitation: [1.2],
        temperature_2m: [12.5],
        time: ["2026-06-01T13:00"],
        wind_gusts_10m: [35],
        wind_speed_10m: [22],
      },
      latitude: 47.6,
      longitude: -122.3,
      timezone: "America/Los_Angeles",
    });

    expect(records[0]).toMatchObject({
      cloudCoverPercent: 90,
      precipitationMm: 1.2,
      provider: "open-meteo",
      temperatureC: 12.5,
      timezone: "America/Los_Angeles",
      windGustKmh: 35,
      windSpeedKmh: 22,
    });
  });

  // contract behavior
  it("throws when required hourly values are missing", () => {
    expect(() =>
      normalizeOpenMeteoResponse({
        hourly: {
          cloud_cover: [90],
          time: ["2026-06-01T13:00"],
        },
        latitude: 47.6,
        longitude: -122.3,
      })
    ).toThrow(Error);
  });

  // fetch behavior
  it("uses injected fetch and throws on failed responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    });

    await expect(
      fetchHistoricalWeather({
        endDate: "2026-06-01",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        latitude: 47.6,
        longitude: -122.3,
        startDate: "2026-06-01",
      })
    ).rejects.toThrow(Error);
  });

  // timeout behavior
  it("passes an abort signal to provider fetches", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({
        hourly: {
          cloud_cover: [],
          precipitation: [],
          temperature_2m: [],
          time: [],
          wind_gusts_10m: [],
          wind_speed_10m: [],
        },
        latitude: 47.6,
        longitude: -122.3,
      }),
      ok: true,
    });

    await fetchHistoricalWeather({
      endDate: "2026-06-01",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      latitude: 47.6,
      longitude: -122.3,
      startDate: "2026-06-01",
      timeoutMs: 50,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  // cost behavior
  it("estimates long-range request cost conservatively", () => {
    expect(estimateOpenMeteoCallCost(1)).toBe(1);
    expect(estimateOpenMeteoCallCost(29)).toBe(3);
  });
});
