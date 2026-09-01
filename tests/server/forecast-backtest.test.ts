import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  addBinaryForecastSample,
  type BacktestCrossing,
  type BacktestMetricSnapshot,
  buildComparableHistoryIndex,
  buildShockHistoryIndex,
  createBinaryForecastStats,
  getBacktestAsOf,
  getBacktestComparableCandidates,
  getBacktestComparisonFailures,
  getBacktestEstimatorInputDigest,
  getComparableHistoryDigest,
  getShockHistoryBeforeAsOf,
  hasForecastCoherenceViolation,
  isPracticalFullEvent,
  isStrictFullEvent,
  parseBacktestLeadMinutes,
  toBinaryForecastReport,
} from "../../server/lib/forecastBacktest";
import { getHistoricalEstimate } from "../../server/lib/forecast";
import { createDemandShockHistoryIndex } from "../../server/lib/forecastDemandShock";

// convert one Pacific fixture
const toSeconds = (value: string): number =>
  DateTime.fromISO(value, { zone: "America/Los_Angeles" }).toSeconds();

// build one backtest row
const crossing = (
  id: number,
  departureTime: number,
  input: Partial<BacktestCrossing> = {}
): BacktestCrossing => ({
  arrivalId: "14",
  departureDelta: 0,
  departureId: "5",
  departureTime,
  driveUpCapacity: 20,
  hasReservations: false,
  id,
  isCancelled: false,
  reservableCapacity: 0,
  totalCapacity: 120,
  ...input,
});

// build one complete metric snapshot
const metricSnapshot = (
  input: Partial<BacktestMetricSnapshot> = {}
): BacktestMetricSnapshot => ({
  coherenceViolationRate: 0,
  highMissRate: 0.1,
  lowMissRate: 0.1,
  mae: 10,
  p90: 20,
  practicalFull: {
    brier: 0.1,
    falseFullRate: 0.1,
    precision: 0.8,
    recall: 0.8,
  },
  strictFull: {
    brier: 0.1,
    falseFullRate: 0.1,
    precision: 0.8,
    recall: 0.8,
  },
  ...input,
});

describe("forecast backtest helpers", () => {
  // lead-time parsing
  it("parses valid lead minutes and rejects invalid values", () => {
    expect(parseBacktestLeadMinutes(null)).toBe(30);
    expect(parseBacktestLeadMinutes("0")).toBe(0);
    expect(parseBacktestLeadMinutes("120")).toBe(120);
    expect(() => parseBacktestLeadMinutes("-1")).toThrow(
      "Invalid lead minutes"
    );
    expect(() => parseBacktestLeadMinutes("invalid")).toThrow(
      "Invalid lead minutes"
    );
  });

  // explicit Pacific as-of ownership
  it("subtracts lead time from the target instant across DST", () => {
    const target = toSeconds("2026-03-08T03:30:00-07:00");
    const asOf = getBacktestAsOf(target, 60);

    expect(asOf.toSeconds()).toBe(target - 60 * 60);
    expect(asOf.zoneName).toBe("America/Los_Angeles");
    expect(asOf.toFormat("HH:mm ZZZ")).toBe("01:30 -0800");
  });

  // dual history indexes
  it("limits comparable history but preserves every direction row before asOf", () => {
    const targetTime = toSeconds("2026-08-31T14:00:00");
    const target = crossing(100, targetTime);
    const sameDirection = Array.from({ length: 12 }, (_, index) => {
      // build chronological same-hour rows
      return crossing(
        index,
        DateTime.fromSeconds(targetTime, {
          zone: "America/Los_Angeles",
        })
          .minus({ days: 12 - index })
          .toSeconds()
      );
    });
    const atAsOf = crossing(20, targetTime - 30 * 60);
    const reverse = crossing(21, targetTime - 24 * 60 * 60, {
      arrivalId: "5",
      departureId: "14",
    });
    const history = [...sameDirection, atAsOf, reverse];
    const asOf = targetTime - 30 * 60;

    const comparable = getBacktestComparableCandidates(
      target,
      buildComparableHistoryIndex(history),
      5,
      asOf
    );
    const shockHistory = getShockHistoryBeforeAsOf(
      target,
      buildShockHistoryIndex(history),
      asOf
    );

    expect(comparable).toHaveLength(5);
    expect(comparable.map(({ id }) => id)).toEqual([7, 8, 9, 10, 11]);
    expect(shockHistory).toHaveLength(12);
    expect(shockHistory).not.toContain(atAsOf);
    expect(shockHistory).not.toContain(reverse);
    expect(getComparableHistoryDigest(comparable)).toBe(
      getComparableHistoryDigest([...comparable])
    );
  });

  // estimator audit fingerprints
  it("fingerprints actual row values, weights, capacity, and asOf", () => {
    const audit = {
      arrivalId: "14",
      asOf: 100,
      departureId: "5",
      samples: [
        {
          arrivalId: "14",
          departureId: "5",
          departureTime: 90,
          driveUpCapacity: 20,
          id: 1,
          normalizedDriveUpCapacity: 20,
          normalizedReservableCapacity: 0,
          reservableCapacity: 0,
          totalCapacity: 120,
          weight: 0.75,
        },
      ],
      targetCapacity: 120,
      targetDepartureTime: 130,
      targetId: 999,
    };

    expect(getBacktestEstimatorInputDigest(audit)).not.toBe(
      getBacktestEstimatorInputDigest({
        ...audit,
        samples: [{ ...audit.samples[0], weight: 0.5 }],
      })
    );
    expect(getBacktestEstimatorInputDigest(audit)).not.toBe(
      getBacktestEstimatorInputDigest({ ...audit, asOf: 101 })
    );
    expect(getBacktestEstimatorInputDigest(audit)).not.toBe(
      getBacktestEstimatorInputDigest({ ...audit, targetCapacity: 141 })
    );
  });

  // full shock history remains independent from base truncation
  it("activates same-day shock from reference rows outside base candidates", () => {
    const asOf = DateTime.fromISO("2026-08-31T12:00:00", {
      zone: "America/Los_Angeles",
    });
    const targetTime = asOf.set({ hour: 14 });
    const target = crossing(999, targetTime.toSeconds(), {
      driveUpCapacity: 0,
      totalCapacity: 200,
    });
    const baseRows = Array.from({ length: 8 }, (_, index) => {
      // create same-hour baseline rows
      return crossing(
        100 + index,
        asOf
          .minus({ weeks: 4 + index })
          .set({ hour: 14, minute: 0, second: 0, millisecond: 0 })
          .toSeconds(),
        { driveUpCapacity: 60, totalCapacity: 200 }
      );
    });
    const referenceRows = Array.from({ length: 20 }, (_, index) => {
      // create established morning references
      return crossing(
        200 + index,
        asOf
          .minus({ weeks: 4 + index })
          .set({ hour: 8 + (index % 3), minute: 0, second: 0, millisecond: 0 })
          .toSeconds(),
        { driveUpCapacity: 60, totalCapacity: 200 }
      );
    });
    const sameDayRows = [8, 9, 10].map((hour, index) => {
      // create completed overload observations
      return crossing(
        300 + index,
        asOf.set({ hour, minute: 0, second: 0, millisecond: 0 }).toSeconds(),
        { driveUpCapacity: 10, totalCapacity: 200 }
      );
    });
    const history = [...baseRows, ...referenceRows, ...sameDayRows];
    const baseCandidates = getBacktestComparableCandidates(
      target,
      buildComparableHistoryIndex(history),
      5,
      asOf.toSeconds()
    );
    const shockHistory = getShockHistoryBeforeAsOf(
      target,
      buildShockHistoryIndex(history),
      asOf.toSeconds()
    );
    const holidays = {
      2025: new Set<string>(),
      2026: new Set<string>(),
    };
    const route = { arrivalId: "14", departureId: "5" };
    const baseline = getHistoricalEstimate(
      targetTime,
      baseCandidates as never,
      null,
      asOf,
      holidays,
      200,
      route
    );
    const candidate = getHistoricalEstimate(
      targetTime,
      baseCandidates as never,
      null,
      asOf,
      holidays,
      200,
      {
        ...route,
        demandShock: {
          asOf: asOf.toSeconds(),
          baselineFullProbability: baseline?.fullProbability ?? 0,
          history: createDemandShockHistoryIndex(shockHistory),
        },
      }
    );

    expect(baseCandidates).toHaveLength(5);
    expect(baseCandidates.every(({ id }) => Number(id) < 200)).toBe(true);
    expect(shockHistory).toHaveLength(history.length);
    expect(candidate?.demandShockAdjustment?.sameDay).not.toBeNull();
    expect(candidate?.driveUpCapacity).toBeLessThan(
      baseline?.driveUpCapacity ?? 0
    );
  });

  // event family boundaries
  it("matches strict and client practical full boundaries", () => {
    expect(isStrictFullEvent(2, 100)).toBe(true);
    expect(isStrictFullEvent(3, 100)).toBe(false);
    expect(isPracticalFullEvent(9, 100)).toBe(true);
    expect(isPracticalFullEvent(10, 100)).toBe(false);
    expect(isPracticalFullEvent(0, 100)).toBe(true);
  });

  // binary metric math
  it("calculates Brier, recall, precision, and false-full rates", () => {
    const stats = createBinaryForecastStats();
    addBinaryForecastSample(stats, false, 0);
    addBinaryForecastSample(stats, true, 1);
    addBinaryForecastSample(stats, true, 0.5);

    expect(toBinaryForecastReport(stats)).toEqual({
      brier: 1 / 12,
      falseFullRate: 0,
      precision: 1,
      recall: 1,
    });
    expect(toBinaryForecastReport(createBinaryForecastStats())).toEqual({
      brier: 0,
      falseFullRate: 0,
      precision: 0,
      recall: 0,
    });
  });

  // candidate coherence diagnostics
  it("detects every final serving-coherence violation", () => {
    expect(hasForecastCoherenceViolation(0, 120, 0.49)).toBe(true);
    expect(hasForecastCoherenceViolation(12, 120, 0.5)).toBe(true);
    expect(hasForecastCoherenceViolation(43, 120, 0.2)).toBe(true);
    expect(hasForecastCoherenceViolation(0, 120, 0.5)).toBe(false);
    expect(hasForecastCoherenceViolation(11, 120, 0.8)).toBe(false);
    expect(hasForecastCoherenceViolation(43, 120, 0.19)).toBe(false);
  });

  // paired delta gates
  it("passes exact delta boundaries and rejects strictly worse metrics", () => {
    const baseline = metricSnapshot();
    const boundaryCandidate = metricSnapshot({
      mae: 12,
      p90: 25,
      practicalFull: {
        brier: 0.11,
        falseFullRate: 0.12,
        precision: 0.78,
        recall: 0.79,
      },
      strictFull: {
        brier: 0.11,
        falseFullRate: 0.12,
        precision: 0.78,
        recall: 0.79,
      },
    });

    expect(getBacktestComparisonFailures(baseline, boundaryCandidate)).toEqual(
      []
    );
    expect(
      getBacktestComparisonFailures(
        baseline,
        metricSnapshot({ coherenceViolationRate: 0.01, mae: 12.01 })
      )
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("mae delta"),
        expect.stringContaining("coherence violation"),
      ])
    );
  });
});
