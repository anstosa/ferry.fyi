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
  bulkCreate: vi.fn(),
  count: vi.fn(),
}));

const forecastModel = vi.hoisted(() => ({
  bulkCreate: vi.fn(),
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

vi.mock("~/models/TideObservation", () => ({
  TideObservation: observationModel,
}));

vi.mock("~/models/TideForecast", () => ({
  TideForecast: forecastModel,
}));

const { backfillTideObservations, createTideDateChunks } = await import(
  "../../server/lib/tides/backfill"
);
const { resetTideForecastRefreshState, updateTideForecasts } = await import(
  "../../server/lib/tides/updateForecasts"
);

const toSeconds = (input: string): number =>
  DateTime.fromISO(input, { zone: "America/Los_Angeles" }).toSeconds();

const terminal = {
  id: "7",
};

const mateTerminal = {
  id: "9",
};

const tideRecord = {
  datum: "MLLW",
  provider: "noaa-coops",
  stationId: "9447130",
  time: toSeconds("2026-06-01T12:00:00"),
  timezone: "America/Los_Angeles",
  waterLevelM: -0.2,
};

describe("tide ingestion", () => {
  beforeEach(() => {
    crossingModel.max.mockReset();
    crossingModel.min.mockReset();
    terminalModel.getAll.mockReset();
    observationModel.bulkCreate.mockReset();
    observationModel.count.mockReset();
    observationModel.count.mockResolvedValue(0);
    forecastModel.bulkCreate.mockReset();
    resetTideForecastRefreshState();
    terminalModel.getAll.mockReturnValue({ [terminal.id]: terminal });
  });

  // chunk behavior
  it("creates inclusive tide date chunks", () => {
    const chunks = createTideDateChunks(
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

    const report = await backfillTideObservations({ dryRun: true });

    expect(report.chunks).toHaveLength(1);
    expect(report.recordsWritten).toBe(0);
    expect(report.skippedChunks).toBe(0);
    expect(observationModel.bulkCreate).not.toHaveBeenCalled();
  });

  // skip behavior
  it("skips station chunks when mapped terminals are complete", async () => {
    const fetchTides = vi.fn().mockResolvedValue([tideRecord]);
    crossingModel.min.mockResolvedValue(toSeconds("2026-06-01T05:00:00"));
    crossingModel.max.mockResolvedValue(toSeconds("2026-06-01T05:00:00"));
    observationModel.count.mockResolvedValue(24);

    const report = await backfillTideObservations({ fetchTides });

    expect(report.recordsWritten).toBe(0);
    expect(report.skippedChunks).toBe(1);
    expect(fetchTides).not.toHaveBeenCalled();
  });

  // upsert behavior
  it("fetches once per tide station and writes mapped terminals", async () => {
    terminalModel.getAll.mockReturnValue({
      [mateTerminal.id]: mateTerminal,
      [terminal.id]: terminal,
    });
    crossingModel.min.mockResolvedValue(toSeconds("2026-06-01T05:00:00"));
    crossingModel.max.mockResolvedValue(toSeconds("2026-06-01T05:00:00"));

    const fetchTides = vi.fn().mockResolvedValue([tideRecord]);
    const report = await backfillTideObservations({ fetchTides });

    expect(report.recordsWritten).toBe(2);
    expect(fetchTides).toHaveBeenCalledTimes(1);
    expect(observationModel.bulkCreate).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          observedAt: tideRecord.time,
          terminalId: "7",
          waterLevelM: -0.2,
        }),
      ],
      expect.objectContaining({
        conflictAttributes: ["terminalId", "observedAt", "provider"],
      })
    );
  });

  // ttl behavior
  it("does not fetch forecasts again inside the refresh TTL", async () => {
    const fetchTides = vi.fn().mockResolvedValue([tideRecord]);
    const now = DateTime.fromISO("2026-06-01T09:00:00", {
      zone: "America/Los_Angeles",
    });

    const first = await updateTideForecasts({ fetchTides, now, ttlHours: 3 });
    const second = await updateTideForecasts({
      fetchTides,
      now: now.plus({ hours: 1 }),
      ttlHours: 3,
    });

    expect(first.skipped).toBe(false);
    expect(second.skipped).toBe(true);
    expect(fetchTides).toHaveBeenCalledTimes(1);
    expect(forecastModel.bulkCreate).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          forecastFor: tideRecord.time,
          terminalId: "7",
          waterLevelM: -0.2,
        }),
      ],
      expect.objectContaining({
        conflictAttributes: ["terminalId", "forecastFor", "provider"],
      })
    );
  });



  // shared station behavior
  it("counts forecast writes for every terminal mapped to one station", async () => {
    terminalModel.getAll.mockReturnValue({
      [mateTerminal.id]: mateTerminal,
      [terminal.id]: terminal,
    });
    const fetchTides = vi.fn().mockResolvedValue([tideRecord]);
    const now = DateTime.fromISO("2026-06-01T09:00:00", {
      zone: "America/Los_Angeles",
    });

    const report = await updateTideForecasts({ fetchTides, now });

    expect(report).toEqual({ recordsWritten: 2, skipped: false });
    expect(fetchTides).toHaveBeenCalledTimes(1);
    expect(forecastModel.bulkCreate).toHaveBeenCalledTimes(2);
  });

  // provider failure behavior
  it("does not block refreshes when tide forecast fetch fails", async () => {
    const fetchTides = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate limited"))
      .mockResolvedValueOnce([tideRecord]);
    const now = DateTime.fromISO("2026-06-01T09:00:00", {
      zone: "America/Los_Angeles",
    });

    const report = await updateTideForecasts({ fetchTides, now });
    const retry = await updateTideForecasts({
      fetchTides,
      now: now.plus({ minutes: 1 }),
    });

    expect(report).toEqual({ recordsWritten: 0, skipped: false });
    expect(retry).toEqual({ recordsWritten: 1, skipped: false });
    expect(fetchTides).toHaveBeenCalledTimes(2);
  });
});
