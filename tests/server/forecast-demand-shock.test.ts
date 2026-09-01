import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import {
  alignDemandShockPointEstimate,
  combineDemandShockSignals,
  FORECAST_TIME_ZONE,
  getDemandBucket,
  getDemandShockAdjustment,
  getEffectiveSampleSize,
  getHalfLifeWeight,
  getIncrementalRegimeSignal,
  getSameDaySignal,
  isDemandBucketMatch,
  isDemandShockEligible,
  normalizeOccupiedShare,
  regularizeDemandShockDelta,
  regularizeDemandShockProbability,
  shiftCapacityForDemand,
} from "../../server/lib/forecastDemandShock";

// convert one Pacific fixture to epoch seconds
const pacificSeconds = (value: string): number =>
  DateTime.fromISO(value, { zone: FORECAST_TIME_ZONE }).toSeconds();

// build one minimal crossing fixture
const crossing = (
  input: Partial<{
    arrivalId: string;
    departureDelta: number | null;
    departureId: string;
    departureTime: number;
    driveUpCapacity: number;
    isCancelled: boolean;
    reservableCapacity: number;
    totalCapacity: number;
  }> = {}
) => ({
  arrivalId: "14",
  departureDelta: 0,
  departureId: "5",
  departureTime: pacificSeconds("2026-08-31T08:00:00"),
  driveUpCapacity: 20,
  isCancelled: false,
  reservableCapacity: 0,
  totalCapacity: 100,
  ...input,
});

// build weekly target-bucket history
const weeklyRows = ({
  asOf,
  count,
  occupiedVehicles,
  startWeek,
  totalCapacity = 200,
}: {
  asOf: DateTime;
  count: number;
  occupiedVehicles: number;
  startWeek: number;
  totalCapacity?: number;
}) =>
  Array.from({ length: count }, (_, index) => {
    const departure = asOf
      .minus({ weeks: startWeek + index })
      .set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
    return crossing({
      departureTime: departure.toSeconds(),
      driveUpCapacity: totalCapacity - occupiedVehicles,
      totalCapacity,
    });
  });

// build dense recent target-bucket history
const recentRows = ({
  asOf,
  occupiedVehicles,
  totalCapacity,
}: {
  asOf: DateTime;
  occupiedVehicles: number;
  totalCapacity: number;
}) =>
  Array.from({ length: 8 }, (_, index) => {
    const departure = asOf.minus({ weeks: 1 + Math.floor(index / 3) }).set({
      hour: 12 + (index % 3),
      minute: 0,
      second: 0,
      millisecond: 0,
    });
    return crossing({
      departureTime: departure.toSeconds(),
      driveUpCapacity: totalCapacity - occupiedVehicles,
      totalCapacity,
    });
  });

describe("forecast demand shock", () => {
  // normalize occupied vehicles into target space
  it("normalizes occupied counts instead of source utilization", () => {
    expect(normalizeOccupiedShare(crossing(), 160)).toBe(0.5);
    expect(
      normalizeOccupiedShare(
        crossing({ driveUpCapacity: 120, totalCapacity: 200 }),
        160
      )
    ).toBe(0.5);
    expect(
      normalizeOccupiedShare(
        crossing({ driveUpCapacity: 40, totalCapacity: 200 }),
        160
      )
    ).toBe(1);
    expect(
      normalizeOccupiedShare(
        crossing({ driveUpCapacity: -10, totalCapacity: 100 }),
        160
      )
    ).toBe(0.625);
    expect(
      normalizeOccupiedShare(
        crossing({ driveUpCapacity: 120, totalCapacity: 100 }),
        160
      )
    ).toBe(0);
    expect(
      normalizeOccupiedShare(crossing({ totalCapacity: 0 }), 160)
    ).toBeNull();
    expect(normalizeOccupiedShare(crossing(), 0)).toBeNull();
  });

  // enforce direction and strict as-of causality
  it("accepts only finalized same-direction outcomes before asOf", () => {
    const departureTime = pacificSeconds("2026-08-31T08:00:00");
    const finalizedAt = departureTime + 10 * 60;
    const targetDirection = { arrivalId: "14", departureId: "5" };

    expect(
      isDemandShockEligible(
        crossing({ departureTime }),
        targetDirection,
        finalizedAt + 1
      )
    ).toBe(true);
    expect(
      isDemandShockEligible(
        crossing({ departureTime }),
        targetDirection,
        finalizedAt
      )
    ).toBe(false);
    expect(
      isDemandShockEligible(
        crossing({ arrivalId: "5", departureId: "14", departureTime }),
        targetDirection,
        finalizedAt + 1
      )
    ).toBe(false);
    expect(
      isDemandShockEligible(
        crossing({ departureTime, isCancelled: true }),
        targetDirection,
        finalizedAt + 1
      )
    ).toBe(false);
  });

  // calculate stable effective sample sizes
  it("calculates effective sample size without invalid values", () => {
    expect(getEffectiveSampleSize([1, 1, 1, 1])).toBe(4);
    expect(getEffectiveSampleSize([1, 0, -1])).toBe(1);
    expect(getEffectiveSampleSize([1, 0.5])).toBeCloseTo(1.8);
    expect(getEffectiveSampleSize([])).toBe(0);
  });

  // own Pacific bucket boundaries
  it("matches circular hours, weekdays, service dates, and dayparts", () => {
    const monday2300 = pacificSeconds("2026-08-31T23:00:00");
    const tuesday0000 = pacificSeconds("2026-09-01T00:00:00");
    const monday1100 = pacificSeconds("2026-08-31T11:00:00");

    expect(getDemandBucket(tuesday0000)).toMatchObject({
      daypart: "overnight",
      serviceDate: "2026-08-31",
    });
    expect(isDemandBucketMatch(monday2300, tuesday0000)).toBe(false);
    expect(
      isDemandBucketMatch(monday1100, pacificSeconds("2026-08-31T13:00:00"))
    ).toBe(true);
    expect(
      isDemandBucketMatch(monday1100, pacificSeconds("2026-08-31T14:00:00"))
    ).toBe(false);
    expect(
      isDemandBucketMatch(pacificSeconds("2026-08-31T10:00:00"), monday1100)
    ).toBe(false);
  });

  // separate elapsed decay from Pacific calendar fields
  it("handles DST with elapsed half-life weights", () => {
    const springBefore = pacificSeconds("2026-03-08T01:30:00-08:00");
    const springAfter = pacificSeconds("2026-03-08T03:30:00-07:00");
    const fallFirst = pacificSeconds("2026-11-01T01:30:00-07:00");
    const fallSecond = pacificSeconds("2026-11-01T01:30:00-08:00");

    expect(springAfter - springBefore).toBe(60 * 60);
    expect(getHalfLifeWeight(springAfter - springBefore, 60 * 60)).toBe(0.5);
    expect(getDemandBucket(springAfter).hour).toBe(3);
    expect(fallSecond - fallFirst).toBe(60 * 60);
    expect(getDemandBucket(fallFirst)).toEqual(getDemandBucket(fallSecond));
  });

  // reproduce the incremental regime formula
  it("subtracts the exact base state and caps regime movement", () => {
    const positive = getIncrementalRegimeSignal({
      baseOccupiedShare: 0.72,
      effectiveSampleSize: 8,
      observedOccupiedShare: 0.9,
      referenceOccupiedShare: 0.7,
      sampleSize: 8,
    });
    const negative = getIncrementalRegimeSignal({
      baseOccupiedShare: 0.78,
      effectiveSampleSize: 8,
      observedOccupiedShare: 0.6,
      referenceOccupiedShare: 0.8,
      sampleSize: 8,
    });
    const adapted = getIncrementalRegimeSignal({
      baseOccupiedShare: 0.8,
      effectiveSampleSize: 8,
      observedOccupiedShare: 0.9,
      referenceOccupiedShare: 0.7,
      sampleSize: 8,
    });

    expect(positive.occupiedShareDelta).toBeCloseTo(0.08);
    expect(positive.targetOccupiedShare).toBeCloseTo(0.8);
    expect(negative.occupiedShareDelta).toBeCloseTo(-0.08);
    expect(adapted.occupiedShareDelta).toBeCloseTo(0);
    expect(
      getIncrementalRegimeSignal({
        baseOccupiedShare: 0,
        effectiveSampleSize: 100,
        observedOccupiedShare: 1,
        referenceOccupiedShare: 0,
        sampleSize: 100,
      }).occupiedShareDelta
    ).toBe(0.12);
  });

  // reproduce same-day shrinkage and target decay
  it("weights, shrinks, caps, and decays same-day residuals", () => {
    const samples = [0, 0, 0].map((ageMinutes) => ({
      ageMinutes,
      observedOccupiedShare: 0.8,
      referenceOccupiedShare: 0.6,
    }));
    const twoHours = getSameDaySignal({ hoursUntilTarget: 2, samples });

    expect(twoHours?.rawResidual).toBeCloseTo(0.2);
    expect(twoHours?.occupiedShareDelta).toBeCloseTo(0.05);
    expect(getSameDaySignal({ hoursUntilTarget: 0, samples })).toMatchObject({
      occupiedShareDelta: 0,
    });
    expect(
      getSameDaySignal({ hoursUntilTarget: 1 / 3600, samples })
        ?.occupiedShareDelta
    ).toBeGreaterThan(0);
    expect(getSameDaySignal({ hoursUntilTarget: 7, samples })).toMatchObject({
      occupiedShareDelta: 0,
    });
    expect(
      getSameDaySignal({ hoursUntilTarget: 2, samples: samples.slice(0, 2) })
    ).toBeNull();
  });

  // combine components and suppress immaterial movement
  it("caps combined movement and suppresses sub-one-percent changes", () => {
    const recent = getIncrementalRegimeSignal({
      baseOccupiedShare: 0,
      effectiveSampleSize: 100,
      observedOccupiedShare: 1,
      referenceOccupiedShare: 0,
      sampleSize: 100,
    });
    const sameDay = {
      baseOccupiedShare: null,
      effectiveSampleSize: 5,
      occupiedShareDelta: 0.18,
      observedOccupiedShare: 0.9,
      rawResidual: 0.4,
      referenceOccupiedShare: 0.5,
      sampleSize: 5,
      targetOccupiedShare: null,
    };

    expect(combineDemandShockSignals(recent, sameDay).occupiedShareDelta).toBe(
      0.25
    );
    expect(
      combineDemandShockSignals({ ...recent, occupiedShareDelta: 0.005 }, null)
        .occupiedShareDelta
    ).toBe(0);
    expect(
      combineDemandShockSignals(
        { ...recent, occupiedShareDelta: -0.08 },
        { ...sameDay, occupiedShareDelta: 0.12 }
      ).occupiedShareDelta
    ).toBeCloseTo(0.04);
  });

  // align only material candidate points
  it("aligns strict-full points with candidate probability", () => {
    expect(
      alignDemandShockPointEstimate(
        { driveUpCapacity: 0, reservableCapacity: 0 },
        0.49,
        0.08,
        120
      )
    ).toEqual({ driveUpCapacity: 3, reservableCapacity: 0 });
    expect(
      alignDemandShockPointEstimate(
        { driveUpCapacity: 0, reservableCapacity: 0 },
        0.49,
        0,
        120
      )
    ).toEqual({ driveUpCapacity: 0, reservableCapacity: 0 });
    expect(
      alignDemandShockPointEstimate(
        { driveUpCapacity: 2, reservableCapacity: 0 },
        0.5,
        0.08,
        120
      )
    ).toEqual({ driveUpCapacity: 2, reservableCapacity: 0 });
  });

  // shift available capacity without inventing reservations
  it("moves occupied vehicles through drive-up before reservable space", () => {
    expect(
      shiftCapacityForDemand(
        { driveUpCapacity: 20, reservableCapacity: 15 },
        0.25,
        120
      )
    ).toEqual({ driveUpCapacity: 0, reservableCapacity: 5 });
    expect(
      shiftCapacityForDemand(
        { driveUpCapacity: 20, reservableCapacity: 15 },
        -0.25,
        120
      )
    ).toEqual({ driveUpCapacity: 50, reservableCapacity: 15 });
    expect(
      shiftCapacityForDemand(
        { driveUpCapacity: 20, reservableCapacity: null },
        0.25,
        120
      )
    ).toEqual({ driveUpCapacity: 0, reservableCapacity: null });
  });

  // calculate one complete leak-free regime adjustment
  it("derives an incremental recent regime from full direction history", () => {
    const asOf = DateTime.fromISO("2026-08-31T12:00:00", {
      zone: FORECAST_TIME_ZONE,
    });
    const reference = weeklyRows({
      asOf,
      count: 20,
      occupiedVehicles: 140,
      startWeek: 4,
    });
    const recent = recentRows({
      asOf,
      occupiedVehicles: 180,
      totalCapacity: 200,
    });

    const adjustment = getDemandShockAdjustment({
      asOf: asOf.toSeconds(),
      baseSamples: Array.from({ length: 8 }, () => ({
        driveUpCapacity: 56,
        reservableCapacity: 0,
        weight: 1,
      })),
      history: [...reference, ...recent],
      target: {
        arrivalId: "14",
        departureId: "5",
        departureTime: asOf.set({ hour: 14 }).toSeconds(),
        targetCapacity: 200,
      },
    });

    expect(adjustment.recentRegime).not.toBeNull();
    expect(adjustment.recentRegime?.referenceOccupiedShare).toBeCloseTo(0.7);
    expect(adjustment.recentRegime?.observedOccupiedShare).toBeCloseTo(0.9);
    expect(adjustment.occupiedShareDelta).toBeGreaterThan(0.06);
    expect(adjustment.occupiedShareDelta).toBeLessThan(0.1);
    expect(adjustment.sameDay).toBeNull();
  });

  // preserve the independent same-day signal
  it("measures same-day demand against its established bucket", () => {
    const asOf = DateTime.fromISO("2026-08-31T12:00:00", {
      zone: FORECAST_TIME_ZONE,
    });
    const reference = weeklyRows({
      asOf,
      count: 20,
      occupiedVehicles: 140,
      startWeek: 4,
    });
    const recent = recentRows({
      asOf,
      occupiedVehicles: 180,
      totalCapacity: 200,
    });
    const sameDayReference = Array.from({ length: 20 }, (_, index) =>
      crossing({
        departureTime: asOf
          .minus({ weeks: 4 + index })
          .set({ hour: 9 })
          .toSeconds(),
        driveUpCapacity: 60,
        totalCapacity: 200,
      })
    );
    const sameDay = [8, 9, 10].map((hour) =>
      crossing({
        departureTime: asOf.set({ hour }).toSeconds(),
        driveUpCapacity: 20,
        totalCapacity: 200,
      })
    );

    const adjustment = getDemandShockAdjustment({
      asOf: asOf.toSeconds(),
      baseSamples: [{ driveUpCapacity: 60, reservableCapacity: 0, weight: 1 }],
      history: [...reference, ...sameDayReference, ...recent, ...sameDay],
      target: {
        arrivalId: "14",
        departureId: "5",
        departureTime: asOf.plus({ minutes: 30 }).toSeconds(),
        targetCapacity: 200,
      },
    });

    expect(adjustment.recentRegime?.targetOccupiedShare).toBeGreaterThan(0.7);
    expect(adjustment.sameDay?.baseOccupiedShare).toBeNull();
    expect(adjustment.sameDay?.referenceOccupiedShare).toBeCloseTo(0.7);
    expect(adjustment.sameDay?.rawResidual).toBeCloseTo(0.2);
    expect(adjustment.sameDay?.occupiedShareDelta).toBeGreaterThan(0);
  });

  // protect warnings while adapting quickly to overload
  it("applies continuous asymmetric demand response curves", () => {
    expect(regularizeDemandShockDelta(0)).toBe(0);
    expect(regularizeDemandShockDelta(0.125)).toBeCloseTo(0.125);
    expect(regularizeDemandShockDelta(-0.125)).toBeCloseTo(-0.0625);
    expect(regularizeDemandShockDelta(-0.25)).toBeCloseTo(-0.25);
    expect(regularizeDemandShockDelta(-0.5)).toBeCloseTo(-0.25);
    expect(regularizeDemandShockProbability(0.4, 0.8, 0)).toBeCloseTo(0.4);
    expect(regularizeDemandShockProbability(0.4, 0.8, 0.125)).toBeCloseTo(0.7);
    expect(regularizeDemandShockProbability(0.8, 0.4, -0.125)).toBeCloseTo(0.7);
    expect(regularizeDemandShockProbability(0.4, 0.8, 0.25)).toBeCloseTo(0.8);
    expect(regularizeDemandShockProbability(0.8, 0.4, -0.25)).toBeCloseTo(0.4);
    const positiveSweep = [0, 0.05, 0.1, 0.15, 0.2, 0.25].map((delta) => {
      return regularizeDemandShockProbability(0.4, 0.8, delta);
    });
    expect(positiveSweep.map((value) => Number(value.toFixed(3)))).toEqual([
      0.4, 0.544, 0.656, 0.736, 0.784, 0.8,
    ]);
    const negativeSweep = [0, -0.05, -0.1, -0.15, -0.2, -0.25].map(
      (delta) => {
        return regularizeDemandShockProbability(0.8, 0.4, delta);
      }
    );
    expect(negativeSweep.map((value) => Number(value.toFixed(3)))).toEqual([
      0.8, 0.784, 0.736, 0.656, 0.544, 0.4,
    ]);
  });

  // prevent source-vessel mix from manufacturing a regime
  it("keeps equal occupied counts stable across source vessel sizes", () => {
    const asOf = DateTime.fromISO("2026-08-31T12:00:00", {
      zone: FORECAST_TIME_ZONE,
    });
    const reference = weeklyRows({
      asOf,
      count: 20,
      occupiedVehicles: 80,
      startWeek: 4,
      totalCapacity: 100,
    });
    const recent = recentRows({
      asOf,
      occupiedVehicles: 80,
      totalCapacity: 200,
    });

    const adjustment = getDemandShockAdjustment({
      asOf: asOf.toSeconds(),
      baseSamples: [{ driveUpCapacity: 120, reservableCapacity: 0, weight: 1 }],
      history: [...reference, ...recent],
      target: {
        arrivalId: "14",
        departureId: "5",
        departureTime: asOf.set({ hour: 14 }).toSeconds(),
        targetCapacity: 200,
      },
    });

    expect(adjustment.recentRegime?.rawResidual).toBeCloseTo(0);
    expect(adjustment.occupiedShareDelta).toBe(0);
  });
});
