import { DateTime } from "luxon";
import { Op } from "sequelize";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const scheduleModel = vi.hoisted(() => ({
  getAll: vi.fn(),
}));

const crossingModel = vi.hoisted(() => ({
  count: vi.fn(),
  findAll: vi.fn(),
  max: vi.fn(),
  min: vi.fn(),
}));

const terminalModel = vi.hoisted(() => ({
  getByIndex: vi.fn(),
}));

const holidayModel = vi.hoisted(() => ({
  getWashingtonHolidayDates: vi.fn(),
}));

const weatherAdjustmentModel = vi.hoisted(() => ({
  createWeatherAdjustmentContext: vi.fn(),
  getWeatherAdjustedCapacity: vi.fn(),
}));

vi.mock("heroku-logger", () => ({
  default: { info: vi.fn() },
}));

vi.mock("~/models/Schedule", () => ({
  Schedule: scheduleModel,
}));

vi.mock("~/models/Crossing", () => ({
  default: crossingModel,
}));

vi.mock("~/models/Terminal", () => ({
  Terminal: terminalModel,
}));

vi.mock("~/lib/holidays", () => holidayModel);

vi.mock("~/lib/weather/capacityAdjustment", () => weatherAdjustmentModel);

const { updateEstimates } = await import("../../server/lib/forecast");

const terminal = {
  id: "1",
  location: {
    address: {},
    latitude: 47.60249,
    longitude: -122.33987,
  },
};

const toSeconds = (input: string): number =>
  DateTime.fromISO(input, { zone: "America/Los_Angeles" }).toSeconds();

const createCrossing = (input: Record<string, unknown>) => ({
  arrivalId: "2",
  departureDelta: null,
  departureId: "1",
  departureTime: toSeconds("2026-06-21T12:00:00"),
  capacityReportUpdatedAt: toSeconds("2026-06-21T09:45:00"),
  driveUpCapacity: 80,
  hasDriveUp: true,
  hasReservations: true,
  isCancelled: false,
  reservableCapacity: 20,
  totalCapacity: 100,
  ...input,
});

const createSchedule = (slot: Record<string, unknown>) => ({
  date: "2026-06-21",
  key: "1-2-2026-06-21",
  mateId: "2",
  slots: [
    {
      allowsPassengers: true,
      allowsVehicles: true,
      hasPassed: false,
      mateId: "2",
      time: toSeconds("2026-06-21T12:00:00"),
      vessel: { id: "vessel", tallVehicleCapacity: 0, vehicleCapacity: 100 },
      wuid: "slot",
      ...slot,
    },
  ],
  terminalId: "1",
  validRange: null,
});

describe("forecast estimates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T17:00:00.000Z"));
    scheduleModel.getAll.mockReset();
    crossingModel.count.mockReset();
    crossingModel.findAll.mockReset();
    crossingModel.max.mockReset();
    crossingModel.min.mockReset();
    terminalModel.getByIndex.mockReset();
    holidayModel.getWashingtonHolidayDates.mockReset();
    crossingModel.count.mockResolvedValue(0);
    crossingModel.max.mockResolvedValue(null);
    crossingModel.min.mockResolvedValue(null);
    terminalModel.getByIndex.mockReturnValue(terminal);
    holidayModel.getWashingtonHolidayDates.mockResolvedValue(new Set());
    weatherAdjustmentModel.getWeatherAdjustedCapacity.mockReset();
    weatherAdjustmentModel.createWeatherAdjustmentContext.mockReset();
    weatherAdjustmentModel.createWeatherAdjustmentContext.mockResolvedValue(
      null
    );
    weatherAdjustmentModel.getWeatherAdjustedCapacity.mockImplementation(
      async ({ capacity }) => capacity
    );
  });

  // timer cleanup
  afterEach(() => {
    vi.useRealTimers();
  });

  // blend behavior
  it("loads two years of history for each estimate", async () => {
    const schedule = createSchedule({});
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([]);

    await updateEstimates();

    expect(crossingModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          departureTime: { [Op.gte]: toSeconds("2024-06-21T12:00:00") },
        }),
      })
    );
  });

  // blend behavior
  it("blends live capacity with recency-weighted historical outcomes", async () => {
    const liveCrossing = createCrossing({
      driveUpCapacity: 60,
      reservableCapacity: 20,
    });
    const schedule = createSchedule({ crossing: liveCrossing });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2026-06-14T12:00:00"),
        driveUpCapacity: 20,
        reservableCapacity: 0,
      }),
      createCrossing({
        departureTime: toSeconds("2026-06-07T12:00:00"),
        driveUpCapacity: 40,
        reservableCapacity: 0,
      }),
      createCrossing({
        departureTime: toSeconds("2026-06-20T12:00:00"),
        driveUpCapacity: 90,
        reservableCapacity: 10,
      }),
      createCrossing({
        departureTime: toSeconds("2026-06-21T12:00:00"),
        driveUpCapacity: 10,
        reservableCapacity: 0,
      }),
    ]);

    await updateEstimates();

    expect(
      weatherAdjustmentModel.createWeatherAdjustmentContext
    ).toHaveBeenCalledWith(
      expect.objectContaining({ now: expect.any(DateTime) })
    );
    expect(schedule.slots[0].estimate).toMatchObject({
      confidence: "medium",
      factors: expect.arrayContaining([
        expect.objectContaining({ label: "Historical pattern" }),
        expect.objectContaining({ label: "Current WSF vehicle-space report data included" }),
      ]),
      sampleSize: 2,
      source: "blended",
    });
    expect(schedule.slots[0].estimate.driveUpCapacity).toBeLessThan(80);
    expect(schedule.slots[0].estimate.driveUpCapacity).toBeGreaterThan(20);
  });

  // historical copy behavior
  it("formats historical pattern volume and database history", async () => {
    const schedule = createSchedule({});
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    const baseTime = DateTime.fromISO("2026-06-14T12:00:00", {
      zone: "America/Los_Angeles",
    });
    crossingModel.findAll.mockResolvedValue(
      // comparable records
      Array.from({ length: 1234 }, (_, index) =>
        createCrossing({
          departureTime: baseTime.minus({ weeks: index }).toSeconds(),
          driveUpCapacity: 40,
          reservableCapacity: 0,
        })
      )
    );
    crossingModel.count.mockResolvedValue(4567);
    crossingModel.min.mockResolvedValue(toSeconds("2019-06-28T15:35:00"));
    crossingModel.max.mockResolvedValue(toSeconds("2026-07-05T23:45:00"));

    await updateEstimates();

    const historicalPattern = schedule.slots[0].estimate?.factors?.find(
      (factor) => {
        // historical factor match
        return factor.label === "Historical pattern";
      }
    );
    expect(historicalPattern?.detail).toBe(
      "1,234 comparable past sailings are weighted by date, time, route, and vessel capacity. 4,567 total sailings over 8 years recorded for this route."
    );
  }, 10_000);

  // weather detail copy
  it("includes concise weather details in weather factors", async () => {
    const schedule = createSchedule({});
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2026-06-14T12:00:00"),
        driveUpCapacity: 20,
        reservableCapacity: 0,
      }),
    ]);
    weatherAdjustmentModel.createWeatherAdjustmentContext.mockResolvedValue({
      adjustmentsByBucket: new Map(),
      forecastsByHour: new Map([
        [
          toSeconds("2026-06-21T12:00:00"),
          {
            cloudCoverPercent: 63,
            precipitationMm: 1,
            temperatureC: 15,
            windGustKmh: 30,
            windSpeedKmh: 12,
          },
        ],
        [
          toSeconds("2026-06-21T15:00:00"),
          {
            cloudCoverPercent: 20,
            precipitationMm: 0,
            temperatureC: 25,
            windGustKmh: 20,
            windSpeedKmh: 8,
          },
        ],
      ]),
    });

    await updateEstimates();

    const weatherFactor = schedule.slots[0].estimate?.factors?.find(
      (factor) => {
        // weather factor match
        return factor.label === "No weather impact";
      }
    );
    expect(weatherFactor?.detail).toBe(
      "77°F high, 63% cover, 0.04 in, 7-19 mph wind"
    );
  });


  // dry weather detail copy
  it("uses clear and none for dry weather details", async () => {
    const schedule = createSchedule({});
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2026-06-14T12:00:00"),
        driveUpCapacity: 20,
        reservableCapacity: 0,
      }),
    ]);
    weatherAdjustmentModel.createWeatherAdjustmentContext.mockResolvedValue({
      adjustmentsByBucket: new Map(),
      forecastsByHour: new Map([
        [
          toSeconds("2026-06-21T12:00:00"),
          {
            cloudCoverPercent: 0,
            precipitationMm: 0,
            temperatureC: 20,
            windGustKmh: 8,
            windSpeedKmh: 8,
          },
        ],
      ]),
    });

    await updateEstimates();

    const weatherFactor = schedule.slots[0].estimate?.factors?.find(
      (factor) => {
        // weather factor match
        return factor.label === "No weather impact";
      }
    );
    expect(weatherFactor?.detail).toBe(
      "68°F high, clear, None, 5 mph wind"
    );
  });

  // stale live behavior
  it("uses history when a future live row still reports every space open", async () => {
    const liveCrossing = createCrossing({
      capacityReportUpdatedAt: null,
      driveUpCapacity: 100,
      reservableCapacity: 0,
    });
    const schedule = createSchedule({ crossing: liveCrossing });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2026-06-14T12:00:00"),
        driveUpCapacity: 10,
        reservableCapacity: 0,
      }),
    ]);

    await updateEstimates();

    expect(schedule.slots[0].estimate).toMatchObject({
      driveUpCapacity: 10,
      factors: expect.arrayContaining([
        expect.objectContaining({
          impact: "neutral",
          label: "No reported capacity data yet",
        }),
      ]),
      reservableCapacity: 0,
      source: "historical",
    });
  });

  // fresh live behavior
  it("trusts a fresh all-open capacity report", async () => {
    const liveCrossing = createCrossing({
      capacityReportUpdatedAt: toSeconds("2026-06-21T09:50:00"),
      driveUpCapacity: 100,
      reservableCapacity: 0,
    });
    const schedule = createSchedule({ crossing: liveCrossing });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2026-06-14T12:00:00"),
        driveUpCapacity: 10,
        reservableCapacity: 0,
      }),
    ]);

    await updateEstimates();

    expect(schedule.slots[0].estimate).toMatchObject({
      driveUpCapacity: expect.any(Number),
      source: "blended",
    });
    expect(schedule.slots[0].estimate.driveUpCapacity).toBeGreaterThan(10);
  });

  // vessel capacity normalization
  it("forecasts car counts instead of fullness percentages across boat sizes", async () => {
    const schedule = createSchedule({
      vessel: {
        id: "small-vessel",
        tallVehicleCapacity: 0,
        vehicleCapacity: 120,
      },
    });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2026-06-14T12:00:00"),
        driveUpCapacity: 100,
        reservableCapacity: 0,
        totalCapacity: 200,
      }),
    ]);

    await updateEstimates();

    expect(schedule.slots[0].estimate).toMatchObject({
      driveUpCapacity: 20,
      reservableCapacity: 0,
      source: "historical",
    });
  });

  // holiday behavior
  it("weights matching holiday history over ordinary same-weekday history", async () => {
    const schedule = createSchedule({
      time: toSeconds("2026-07-04T12:00:00"),
    });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    holidayModel.getWashingtonHolidayDates.mockImplementation(
      async (year: number) =>
        new Set(year === 2026 ? ["2026-07-04"] : ["2025-07-04"])
    );
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2025-07-04T12:00:00"),
        driveUpCapacity: 5,
        reservableCapacity: 0,
      }),
      createCrossing({
        departureTime: toSeconds("2026-06-20T12:00:00"),
        driveUpCapacity: 80,
        reservableCapacity: 0,
      }),
    ]);

    await updateEstimates();

    expect(schedule.slots[0].estimate).toMatchObject({
      sampleSize: 2,
      source: "historical",
    });
    expect(schedule.slots[0].estimate.driveUpCapacity).toBeLessThan(50);
  });

  // holiday surge behavior
  it("uses holiday-window tail risk instead of averaging away full sailings", async () => {
    const schedule = createSchedule({
      time: toSeconds("2026-07-04T10:00:00"),
    });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    holidayModel.getWashingtonHolidayDates.mockImplementation(
      async (year: number) =>
        new Set(year === 2026 ? ["2026-07-04"] : ["2025-07-04"])
    );
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2025-07-03T10:00:00"),
        driveUpCapacity: 0,
        reservableCapacity: 0,
      }),
      createCrossing({
        departureTime: toSeconds("2025-07-04T10:00:00"),
        driveUpCapacity: 0,
        reservableCapacity: 0,
      }),
      createCrossing({
        departureTime: toSeconds("2025-07-05T10:00:00"),
        driveUpCapacity: 0,
        reservableCapacity: 0,
      }),
      createCrossing({
        departureTime: toSeconds("2025-07-06T10:00:00"),
        driveUpCapacity: 80,
        reservableCapacity: 0,
      }),
    ]);

    await updateEstimates();

    expect(schedule.slots[0].estimate).toMatchObject({
      driveUpCapacity: 0,
      fullRisk: "high",
      reservableCapacity: 0,
      routeClass: "reservation",
      source: "historical",
    });
  });

  // weather adjustment behavior
  it("applies weather adjustment before live capacity constraints", async () => {
    const liveCrossing = createCrossing({});
    const schedule = createSchedule({ crossing: liveCrossing });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2026-06-14T12:00:00"),
        driveUpCapacity: 20,
        reservableCapacity: 0,
      }),
    ]);
    weatherAdjustmentModel.getWeatherAdjustedCapacity.mockResolvedValue({
      driveUpCapacity: 120,
      reservableCapacity: 50,
    });

    await updateEstimates();

    expect(schedule.slots[0].estimate).toMatchObject({
      driveUpCapacity: 80,
      reservableCapacity: 20,
    });
    expect(
      weatherAdjustmentModel.getWeatherAdjustedCapacity
    ).toHaveBeenCalled();
  });

  // departed sailing behavior
  it("does not apply weather adjustment to passed sailings", async () => {
    const liveCrossing = createCrossing({});
    const schedule = createSchedule({
      crossing: liveCrossing,
      hasPassed: true,
    });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2026-06-14T12:00:00"),
        driveUpCapacity: 20,
        reservableCapacity: 0,
      }),
    ]);
    weatherAdjustmentModel.getWeatherAdjustedCapacity.mockResolvedValue({
      driveUpCapacity: 0,
      reservableCapacity: 0,
    });

    await updateEstimates();

    expect(
      weatherAdjustmentModel.getWeatherAdjustedCapacity
    ).not.toHaveBeenCalled();
    expect(schedule.slots[0].estimate).toMatchObject({
      driveUpCapacity: expect.any(Number),
      reservableCapacity: expect.any(Number),
    });
  });

  // disruption behavior
  it("marks cancelled sailings as low-confidence disruption forecasts", async () => {
    const liveCrossing = createCrossing({ isCancelled: true });
    const schedule = createSchedule({ crossing: liveCrossing });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([
      createCrossing({
        departureTime: toSeconds("2026-06-14T12:00:00"),
        driveUpCapacity: 20,
        reservableCapacity: 0,
      }),
    ]);

    await updateEstimates();

    expect(schedule.slots[0].estimate).toMatchObject({
      confidence: "low",
      driveUpCapacity: 80,
      reservableCapacity: 20,
      source: "disruption",
    });
  });

  // cancellation rollover behavior
  it("adds sixty percent of cancelled demand to the next sailing", async () => {
    const cancelledCrossing = createCrossing({
      departureTime: toSeconds("2026-06-21T12:00:00"),
      driveUpCapacity: 40,
      isCancelled: true,
      reservableCapacity: 0,
      totalCapacity: 100,
    });
    const nextCrossing = createCrossing({
      departureTime: toSeconds("2026-06-21T13:00:00"),
      driveUpCapacity: 100,
      reservableCapacity: 0,
      totalCapacity: 100,
    });
    const schedule = createSchedule({ crossing: cancelledCrossing });
    schedule.slots.push({
      ...schedule.slots[0],
      crossing: nextCrossing,
      time: toSeconds("2026-06-21T13:00:00"),
      wuid: "next-slot",
    });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([]);

    await updateEstimates();

    expect(schedule.slots[1].estimate).toMatchObject({
      driveUpCapacity: 64,
      reservableCapacity: 0,
    });
  });
});
