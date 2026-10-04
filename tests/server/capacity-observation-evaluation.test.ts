import { describe, expect, it } from "vitest";

import {
  deriveCapacityFillLabel,
  deriveCapacityFillLabelResult,
  evaluateFillTimingCases,
  getFillIntervalErrorSeconds,
} from "../../server/lib/capacityObservationsEvaluation";
import type { FillTimingObservation } from "../../server/lib/fillTiming";

const DEPARTURE_AT = 2_000_000_000;

// build one label-eligible direct observation
const observation = (
  receivedAt: number,
  driveUpSpaces: number,
  overrides: Partial<FillTimingObservation> = {}
): FillTimingObservation => ({
  allocationGroupId: `group-${receivedAt}`,
  departureTime: DEPARTURE_AT,
  driveUpDisplayed: true,
  driveUpSpaces,
  isCancelled: false,
  maxSpaceCount: 120,
  pollId: `poll-${receivedAt}`,
  receivedAt,
  reportingStateAtReceipt: "active",
  sourceKind: "wsf-direct",
  usableForFillLabel: true,
  vesselId: "15",
  ...overrides,
});

describe("capacity fill labels and evaluation", () => {
  // an upstream omission before departure is not proof of remaining space
  it.each([301, 37 * 60])(
    "excludes an outcome missing its last %s seconds",
    (lead) => {
      const lastObservationAt = DEPARTURE_AT - lead;
      const observations = [observation(lastObservationAt, 26)];
      expect(deriveCapacityFillLabel(observations, DEPARTURE_AT)).toEqual({
        kind: "right-censored-early",
        lastObservationAt,
      });
      const report = evaluateFillTimingCases([
        {
          arrivalAt: lastObservationAt,
          asOf: lastObservationAt,
          departureEstimate: 21,
          observations,
          projectedDepartureAt: DEPARTURE_AT,
        },
      ]);
      expect(report.eligible).toBe(0);
      expect(report.excluded).toEqual({ "right-censored-early": 1 });
      expect(report.eventBeforeDeparture).toMatchObject({
        falseNegative: 0,
        falsePositive: 0,
        trueNegative: 0,
        truePositive: 0,
      });
    }
  );

  // preserve receipt-time interval censoring
  it("labels direct positive-to-zero evidence as an interval", () => {
    const label = deriveCapacityFillLabel(
      [
        observation(DEPARTURE_AT - 20 * 60, 10),
        observation(DEPARTURE_AT - 19 * 60, 0),
      ],
      DEPARTURE_AT
    );

    expect(label).toEqual({
      firstZeroAt: DEPARTURE_AT - 19 * 60,
      kind: "interval-censored",
      lastPositiveAt: DEPARTURE_AT - 20 * 60,
    });
  });

  // never turn first-zero receipt into an exact event
  it("labels first-zero evidence as left censored", () => {
    expect(
      deriveCapacityFillLabel(
        [observation(DEPARTURE_AT - 20 * 60, 0)],
        DEPARTURE_AT
      )
    ).toEqual({
      firstObservationAt: DEPARTURE_AT - 20 * 60,
      kind: "already-full-by-first-observation",
    });
  });

  // exclude reopened episodes from permanent-first-fill scoring
  it("labels a later positive value as reopened", () => {
    expect(
      deriveCapacityFillLabel(
        [
          observation(DEPARTURE_AT - 20 * 60, 10),
          observation(DEPARTURE_AT - 19 * 60, 0),
          observation(DEPARTURE_AT - 18 * 60, 5),
        ],
        DEPARTURE_AT
      )
    ).toEqual({
      kind: "reopened",
      reopenedAt: DEPARTURE_AT - 18 * 60,
    });
  });

  // prevent invalid rows from being filtered across a fill boundary
  it.each([
    {
      name: "hidden",
      overrides: { driveUpDisplayed: false },
      reason: "hidden",
    },
    {
      name: "cancelled",
      overrides: { isCancelled: true },
      reason: "cancelled",
    },
    {
      name: "invalid",
      overrides: { driveUpSpaces: -1 },
      reason: "invalid",
    },
  ])(
    "resets positive-to-zero labeling across $name evidence",
    ({ overrides, reason }) => {
      const zeroAt = DEPARTURE_AT - 18 * 60;
      const result = deriveCapacityFillLabelResult(
        [
          observation(DEPARTURE_AT - 20 * 60, 10),
          observation(DEPARTURE_AT - 19 * 60, 5, overrides),
          observation(zeroAt, 0),
        ],
        DEPARTURE_AT
      );

      expect(result.label).toEqual({
        firstObservationAt: zeroAt,
        kind: "already-full-by-first-observation",
      });
      expect(result.exclusionReasons).toMatchObject({ [reason]: 1 });
    }
  );

  // measure zero inside and exact distance outside an interval
  it("computes censor-aware interval error", () => {
    const label = {
      firstZeroAt: 200,
      kind: "interval-censored" as const,
      lastPositiveAt: 100,
    };

    expect(getFillIntervalErrorSeconds(150, label)).toBe(0);
    expect(getFillIntervalErrorSeconds(80, label)).toBe(20);
    expect(getFillIntervalErrorSeconds(230, label)).toBe(30);
  });

  // use only issue-time evidence in deterministic replay
  it("reports a deterministic baseline without validation claims", () => {
    const anchorAt = DEPARTURE_AT - 40 * 60;
    const observations = [observation(anchorAt, 30)];
    // preserve five-minute causal continuity through the future label
    for (let leadMinutes = 35; leadMinutes >= 10; leadMinutes -= 5) {
      observations.push(
        observation(DEPARTURE_AT - leadMinutes * 60, leadMinutes - 9)
      );
    }
    observations.push(observation(DEPARTURE_AT - 9 * 60, 0));
    const report = evaluateFillTimingCases([
      {
        arrivalAt: DEPARTURE_AT - 20 * 60,
        asOf: anchorAt,
        daypart: "am",
        departureEstimate: 0,
        observations,
        projectedDepartureAt: DEPARTURE_AT,
        route: "5-14",
      },
    ]);

    expect(report).toMatchObject({
      cohorts: { "5-14:am": 1 },
      eligible: 1,
      modelVersion: "fill-linear-v1",
      total: 1,
      validationClaim: "deterministic-baseline-only",
    });
    expect(report.intervalErrorSeconds.median).toBe(0);
  });

  // score right censoring as a non-event without midpoint fiction
  it("includes right-censored non-events in classification metrics", () => {
    const anchorAt = DEPARTURE_AT - 40 * 60;
    const observations = [observation(anchorAt, 30)];
    // keep the nonfill episode contiguous through departure
    for (let leadMinutes = 35; leadMinutes >= 5; leadMinutes -= 5) {
      observations.push(observation(DEPARTURE_AT - leadMinutes * 60, 20));
    }
    const report = evaluateFillTimingCases([
      {
        arrivalAt: DEPARTURE_AT - 20 * 60,
        asOf: anchorAt,
        departureEstimate: 10,
        observations,
        projectedDepartureAt: DEPARTURE_AT,
      },
    ]);

    expect(report).toMatchObject({
      eligible: 1,
      eventBeforeDeparture: {
        accuracy: 1,
        trueNegative: 1,
      },
      intervalErrorSeconds: { median: null, p90: null },
    });
  });

  // score left censoring as an event without an invented fill instant
  it("includes left-censored events without point error", () => {
    const firstObservationAt = DEPARTURE_AT - 20 * 60;
    const report = evaluateFillTimingCases([
      {
        arrivalAt: DEPARTURE_AT - 10 * 60,
        asOf: firstObservationAt,
        departureEstimate: 0,
        observations: [observation(firstObservationAt, 0)],
        projectedDepartureAt: DEPARTURE_AT,
      },
    ]);

    expect(report).toMatchObject({
      eligible: 1,
      eventBeforeDeparture: { recall: 1, truePositive: 1 },
      intervalErrorSeconds: { median: null, p90: null },
    });
  });
});
