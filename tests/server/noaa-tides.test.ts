import { describe, expect, it, vi } from "vitest";

import {
  fetchTidePredictions,
  getNoaaTideUrl,
  normalizeNoaaTideResponse,
} from "../../server/lib/tides/noaa";

describe("NOAA tide provider", () => {
  // url behavior
  it("builds hourly MLLW prediction URLs", () => {
    const url = new URL(
      getNoaaTideUrl({
        endDate: "2026-06-02",
        stationId: "9447130",
        startDate: "2026-06-01",
      })
    );

    expect(url.hostname).toBe("api.tidesandcurrents.noaa.gov");
    expect(url.searchParams.get("product")).toBe("predictions");
    expect(url.searchParams.get("datum")).toBe("MLLW");
    expect(url.searchParams.get("interval")).toBe("h");
    expect(url.searchParams.get("units")).toBe("metric");
  });

  // mapping behavior
  it("normalizes tide predictions into hourly records", () => {
    const records = normalizeNoaaTideResponse("9447130", {
      predictions: [{ t: "2026-06-01 13:00", v: "1.234" }],
    });

    expect(records[0]).toMatchObject({
      datum: "MLLW",
      provider: "noaa-coops",
      stationId: "9447130",
      timezone: "America/Los_Angeles",
      waterLevelM: 1.234,
    });
  });

  // contract behavior
  it("throws when NOAA returns an error payload", () => {
    expect(() =>
      normalizeNoaaTideResponse("9447130", {
        error: { message: "No Predictions data was found" },
      })
    ).toThrow("No Predictions data");
  });

  // fetch behavior
  it("uses injected fetch and throws on failed responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 429 });

    await expect(
      fetchTidePredictions({
        endDate: "2026-06-01",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        stationId: "9447130",
        startDate: "2026-06-01",
      })
    ).rejects.toThrow(Error);
  });

  // timeout behavior
  it("passes an abort signal to provider fetches", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ predictions: [] }),
      ok: true,
    });

    await fetchTidePredictions({
      endDate: "2026-06-01",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      stationId: "9447130",
      startDate: "2026-06-01",
      timeoutMs: 50,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
