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

const loggerModel = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("~/lib/logger", () => ({
  default: loggerModel,
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

const {
  getCapacityReportingGate,
  getDemandShockMode,
  getHistoricalEstimate,
  isUninformativeFullLiveCapacityLegacy,
  isUninformativeFullLiveCapacityStateful,
  reconcileForecastCoherence,
  runDemandShockMode,
  selectUninformativeFullLiveCapacityClassifier,
  updateEstimates,
} = await import("../../server/lib/forecast");

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
  capacityReportingStartedAt: toSeconds("2026-06-21T08:00:00"),
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
    loggerModel.info.mockReset();
    loggerModel.warn.mockReset();
    process.env.FORECAST_CAPACITY_REPORTING_GATE = "on";
    process.env.FORECAST_DEMAND_SHOCK_MODE = "on";
  });

  // timer cleanup
  afterEach(() => {
    delete process.env.FORECAST_CAPACITY_REPORTING_GATE;
    delete process.env.FORECAST_DEMAND_SHOCK_MODE;
    vi.useRealTimers();
  });

  // runtime mode parsing
  it("uses documented forecast rollout defaults and fallbacks", () => {
    delete process.env.FORECAST_CAPACITY_REPORTING_GATE;
    delete process.env.FORECAST_DEMAND_SHOCK_MODE;

    expect(getCapacityReportingGate()).toBe("on");
    expect(getDemandShockMode()).toBe("on");

    process.env.NODE_ENV = "production";
    expect(getDemandShockMode()).toBe("shadow");

    process.env.FORECAST_CAPACITY_REPORTING_GATE = "invalid";
    process.env.FORECAST_DEMAND_SHOCK_MODE = "invalid";

    expect(getCapacityReportingGate()).toBe("on");
    expect(getDemandShockMode()).toBe("shadow");
    process.env.NODE_ENV = "test";
  });

  // invalid-setting warning contract
  it("warns once for each repeated invalid forecast setting", () => {
    process.env.FORECAST_CAPACITY_REPORTING_GATE =
      "invalid-capacity-telemetry-test";
    process.env.FORECAST_DEMAND_SHOCK_MODE = "invalid-demand-telemetry-test";

    getCapacityReportingGate();
    getCapacityReportingGate();
    getDemandShockMode();
    getDemandShockMode();

    expect(loggerModel.warn.mock.calls).toEqual([
      [
        "FORECAST_CAPACITY_REPORTING_GATE=invalid-capacity-telemetry-test is invalid; using on",
      ],
      [
        "FORECAST_DEMAND_SHOCK_MODE=invalid-demand-telemetry-test is invalid; using on",
      ],
    ]);
  });

  // classifier selection
  it("selects the capacity classifier independently from demand mode", () => {
    expect(selectUninformativeFullLiveCapacityClassifier("on")).toBe(
      isUninformativeFullLiveCapacityStateful
    );
    expect(selectUninformativeFullLiveCapacityClassifier("off")).toBe(
      isUninformativeFullLiveCapacityLegacy
    );
  });

  // stateful capacity reporting
  it.each([
    ["never started at 15 minutes", 15 * 60, 120, null, 60, true],
    ["never started at two hours", 2 * 60 * 60, 120, null, 60, true],
    ["never started at eight hours", 8 * 60 * 60, 120, null, 60, true],
    [
      "fresh after starting",
      30 * 60,
      120,
      toSeconds("2026-06-21T08:00:00"),
      60,
      false,
    ],
    [
      "stale after starting",
      30 * 60,
      120,
      toSeconds("2026-06-21T08:00:00"),
      31 * 60,
      true,
    ],
    ["partial and stale", 30 * 60, 80, null, 31 * 60, false],
    ["above maximum and never started", 30 * 60, 121, null, 60, true],
    ["just below maximum", 30 * 60, 119, null, 60, false],
  ])(
    "classifies %s with reporting state",
    (_label, horizonSeconds, available, startedAt, ageSeconds, expected) => {
      const now = DateTime.fromISO("2026-06-21T10:00:00", {
        zone: "America/Los_Angeles",
      });
      const crossing = createCrossing({
        capacityReportUpdatedAt: now.toSeconds() - Number(ageSeconds),
        capacityReportingStartedAt: startedAt,
        departureTime: now.toSeconds() + Number(horizonSeconds),
        driveUpCapacity: available,
        reservableCapacity: 0,
        totalCapacity: 120,
      });

      expect(
        isUninformativeFullLiveCapacityStateful(
          crossing as never,
          DateTime.fromSeconds(crossing.departureTime),
          now,
          120
        )
      ).toBe(expected);
    }
  );

  // legacy capacity reporting
  it.each([
    ["fresh at thirty minutes", 30 * 60, 120, 60, false],
    ["fresh at exactly four hours", 4 * 60 * 60, 120, 60, false],
    ["fresh just beyond four hours", 4 * 60 * 60 + 1, 120, 60, true],
    ["stale at thirty minutes", 30 * 60, 120, 31 * 60, true],
    ["partial and stale", 8 * 60 * 60, 119, 31 * 60, false],
  ])(
    "preserves legacy behavior for %s",
    (_label, horizonSeconds, available, ageSeconds, expected) => {
      const now = DateTime.fromISO("2026-06-21T10:00:00", {
        zone: "America/Los_Angeles",
      });
      const crossing = createCrossing({
        capacityReportUpdatedAt: now.toSeconds() - Number(ageSeconds),
        departureTime: now.toSeconds() + Number(horizonSeconds),
        driveUpCapacity: available,
        reservableCapacity: 0,
        totalCapacity: 120,
      });

      expect(
        isUninformativeFullLiveCapacityLegacy(
          crossing as never,
          DateTime.fromSeconds(crossing.departureTime),
          now,
          120
        )
      ).toBe(expected);
    }
  );

  // demand mode isolation
  it("keeps shadow output byte-equivalent while computing the candidate", async () => {
    const baseline = {
      driveUpCapacity: 40,
      factors: [{ detail: "", impact: "neutral" as const, label: "baseline" }],
      reservableCapacity: 0,
    };
    const candidate = {
      driveUpCapacity: 0,
      factors: [{ detail: "", impact: "higher" as const, label: "candidate" }],
      reservableCapacity: 0,
    };
    const buildCandidate = vi.fn(() => Promise.resolve(candidate));

    const shadow = await runDemandShockMode("shadow", baseline, buildCandidate);
    const off = await runDemandShockMode("off", baseline, buildCandidate);
    const on = await runDemandShockMode("on", baseline, buildCandidate);

    expect(JSON.stringify(shadow.selected)).toBe(JSON.stringify(baseline));
    expect(off).toEqual({ candidate: null, selected: baseline });
    expect(on.selected).toBe(candidate);
    expect(buildCandidate).toHaveBeenCalledTimes(2);

    candidate.factors.push({
      detail: "",
      impact: "higher",
      label: "candidate mutation",
    });
    expect(JSON.stringify(shadow.selected)).toBe(JSON.stringify(baseline));
  });

  // serving mode isolation
  it("returns the same baseline in off and shadow before enabling candidate coherence", async () => {
    const history = [
      createCrossing({
        departureTime: toSeconds("2026-06-14T12:00:00"),
        driveUpCapacity: 0,
        reservableCapacity: 0,
      }),
    ];
    crossingModel.findAll.mockResolvedValue(history);

    // run one isolated serving mode
    const runMode = async (mode: "off" | "on" | "shadow") => {
      process.env.FORECAST_DEMAND_SHOCK_MODE = mode;
      const schedule = createSchedule({
        crossing: createCrossing({
          capacityReportUpdatedAt: toSeconds("2026-06-21T09:59:00"),
          capacityReportingStartedAt: toSeconds("2026-06-21T09:00:00"),
          driveUpCapacity: 100,
          reservableCapacity: 0,
        }),
      });

      await updateEstimates([schedule as never]);

      return JSON.parse(JSON.stringify(schedule.slots[0].estimate));
    };

    const off = await runMode("off");
    const shadow = await runMode("shadow");
    const on = await runMode("on");

    expect(shadow).toEqual(off);
    expect(on).not.toEqual(off);
    expect(on).toMatchObject({ fullProbability: 0.19, fullRisk: "low" });
  });

  // historical distribution integration
  it("shifts exact historical samples before recalibrating demand risk", () => {
    const asOf = DateTime.fromISO("2026-08-31T12:00:00", {
      zone: "America/Los_Angeles",
    });
    const targetTime = asOf.set({ hour: 14 });
    const reference = Array.from({ length: 20 }, (_, index) => {
      // build established weekly outcomes
      return createCrossing({
        departureTime: asOf
          .minus({ weeks: 4 + index })
          .set({ hour: 14, minute: 0, second: 0, millisecond: 0 })
          .toSeconds(),
        driveUpCapacity: 60,
        reservableCapacity: 0,
        totalCapacity: 200,
      });
    });
    const recent = Array.from({ length: 8 }, (_, index) => {
      // build dense recent outcomes
      return createCrossing({
        departureTime: asOf
          .minus({ weeks: 1 + Math.floor(index / 3) })
          .set({
            hour: 12 + (index % 3),
            minute: 0,
            second: 0,
            millisecond: 0,
          })
          .toSeconds(),
        driveUpCapacity: 20,
        reservableCapacity: 0,
        totalCapacity: 200,
      });
    });
    const holidays = {
      2025: new Set<string>(),
      2026: new Set<string>(),
    };
    const route = { arrivalId: "2", departureId: "1" };
    const baseline = getHistoricalEstimate(
      targetTime,
      reference.slice(0, 8) as never,
      null,
      asOf,
      holidays,
      200,
      route,
      true
    );
    const candidate = getHistoricalEstimate(
      targetTime,
      reference.slice(0, 8) as never,
      null,
      asOf,
      holidays,
      200,
      {
        ...route,
        demandShock: {
          asOf: asOf.toSeconds(),
          baselineFullProbability: baseline?.fullProbability ?? 0,
          history: [...reference, ...recent] as never,
        },
      },
      true
    );

    expect(candidate?.driveUpCapacity).toBeLessThan(
      baseline?.driveUpCapacity ?? 0
    );
    expect(candidate?.factors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          impact: "higher",
          label: "Recent route demand",
        }),
      ])
    );
    expect(candidate?.fullRisk).toBe(
      reconcileForecastCoherence(
        {
          driveUpCapacity: candidate?.driveUpCapacity ?? 0,
          fullProbability: candidate?.fullProbability,
          fullRisk: candidate?.fullRisk,
          reservableCapacity: candidate?.reservableCapacity ?? 0,
        },
        200
      ).fullRisk
    );
  });

  // final candidate coherence
  it.each([
    [0, 120, 0.2, 0.5, "likely"],
    [3, 141, 0.46, 0.46, "unlikely"],
    [4, 141, 0.34, 0.34, "unlikely"],
    [11, 120, 0.2, 0.2, "unlikely"],
    [12, 120, 0.8, 0.49, "unlikely"],
    [42, 120, 0.8, 0.49, "unlikely"],
    [43, 120, 0.8, 0.19, "low"],
  ])(
    "reconciles %s available spaces with probability bounds",
    (
      available,
      totalCapacity,
      probability,
      expectedProbability,
      expectedRisk
    ) => {
      const estimate = reconcileForecastCoherence(
        {
          driveUpCapacity: available,
          fullProbability: probability,
          fullRisk: "high",
          reservableCapacity: 0,
        },
        totalCapacity
      );

      expect(estimate.fullProbability).toBe(expectedProbability);
      expect(estimate.fullRisk).toBe(expectedRisk);
    }
  );

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

  // aggregate telemetry contract
  it("emits one aggregate forecast summary without raw crossing data", async () => {
    const schedule = createSchedule({});
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([]);

    await updateEstimates();

    expect(loggerModel.info).toHaveBeenCalledOnce();
    const [message] = loggerModel.info.mock.calls[0] ?? [];
    expect(message).toEqual(expect.any(String));
    expect(message).toContain("Forecast update complete");
    expect(message).toContain("capacity reporting gate: on");
    expect(message).toContain("demand shock mode: on");
    expect(message).toContain("suppressed all-open rows: 0");
    expect(message).toContain("probability bins before: 0/0/0/0");
    expect(message).toContain("probability bins after: 0/0/0/0");
    expect(message).not.toContain(schedule.slots[0].wuid);
    expect(message).not.toContain("departureTime");
    expect(message).not.toContain("driveUpCapacity");
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
        expect.objectContaining({
          label: "Current WSF vehicle-space report data included",
        }),
      ]),
      sampleSize: 2,
      source: "blended",
    });
    expect(schedule.slots[0].estimate.driveUpCapacity).toBeLessThan(80);
    expect(schedule.slots[0].estimate.driveUpCapacity).toBeGreaterThan(20);
  });

  // historical copy behavior
  // Processing 1,234 deliberately distinct historical rows is CPU-bound and
  // can exceed 20s while the broad suite's workers contend for the host.
  it("formats historical pattern volume and database history", async () => {
    const schedule = createSchedule({});
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    const baseTime = toSeconds("2026-06-14T12:00:00");
    const weekSeconds = 7 * 24 * 60 * 60;
    crossingModel.findAll.mockResolvedValue(
      // comparable records
      Array.from({ length: 1234 }, (_, index) =>
        createCrossing({
          departureTime: baseTime - index * weekSeconds,
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
  }, 30_000);

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
    expect(weatherFactor?.detail).toBe("68°F high, clear, None, 5 mph wind");
  });

  // stale live behavior
  it("uses history when a future live row still reports every space open", async () => {
    const liveCrossing = createCrossing({
      capacityReportUpdatedAt: toSeconds("2026-06-21T09:59:00"),
      capacityReportingStartedAt: null,
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
    expect(schedule.slots[0].estimate.factors).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Current WSF vehicle-space report data included",
        }),
      ])
    );
  });

  // legacy rollback behavior
  it("trusts a fresh never-started all-open row when the state gate is off", async () => {
    process.env.FORECAST_CAPACITY_REPORTING_GATE = "off";
    process.env.FORECAST_DEMAND_SHOCK_MODE = "off";
    const liveCrossing = createCrossing({
      capacityReportUpdatedAt: toSeconds("2026-06-21T09:59:00"),
      capacityReportingStartedAt: null,
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
      source: "blended",
    });
    expect(schedule.slots[0].estimate.driveUpCapacity).toBeGreaterThan(10);
  });

  // legacy live-only rollback
  it.each(["off", "shadow", "on"] as const)(
    "preserves a legacy-classified live row without history in %s mode",
    async (mode) => {
    process.env.FORECAST_CAPACITY_REPORTING_GATE = "off";
    process.env.FORECAST_DEMAND_SHOCK_MODE = mode;
    const departureTime = toSeconds("2026-06-21T15:00:01");
    const liveCrossing = createCrossing({
      capacityReportUpdatedAt: toSeconds("2026-06-21T09:59:00"),
      capacityReportingStartedAt: null,
      departureTime,
      driveUpCapacity: 100,
      reservableCapacity: 0,
    });
    const schedule = createSchedule({
      crossing: liveCrossing,
      time: departureTime,
    });
    scheduleModel.getAll.mockReturnValue({ [schedule.key]: schedule });
    crossingModel.findAll.mockResolvedValue([]);

    await updateEstimates();

    expect(schedule.slots[0].estimate).toMatchObject({
      driveUpCapacity: 100,
      reservableCapacity: 0,
      source: "live",
    });
    }
  );

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

  // sports factor boundaries
  it.each([
    ["at the inbound start", "2026-07-10T15:00:00", "Seattle Mariners"],
    ["after the inbound end", "2026-07-10T20:00:01", undefined],
  ])("reports the sports factor %s", (_label, targetIso, expectedDetail) => {
    const targetTime = DateTime.fromISO(targetIso, {
      zone: "America/Los_Angeles",
    });
    const sportsStart = toSeconds("2026-07-10T19:00:00");
    const estimate = getHistoricalEstimate(
      targetTime,
      [
        createCrossing({
          arrivalId: "7",
          departureId: "3",
          departureTime: targetTime.minus({ weeks: 1 }).toSeconds(),
        }),
      ] as never,
      null,
      DateTime.fromISO("2026-07-10T10:00:00", {
        zone: "America/Los_Angeles",
      }),
      { 2026: new Set<string>() },
      100,
      {
        arrivalId: "7",
        departureId: "3",
        events: [
          {
            endsAt: toSeconds("2026-07-10T23:00:00"),
            eventType: "sports",
            location: "Seattle",
            pressure: 0.1,
            source: "test",
            sourceId: "mariners",
            startsAt: sportsStart,
            title: "Seattle Mariners home game",
          },
        ] as never,
      },
      true
    );
    const sportsFactor = estimate?.factors.find((factor) => {
      // sports factor match
      return factor.label === "Major Seattle home game";
    });

    expect(sportsFactor?.detail).toBe(expectedDetail);
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
