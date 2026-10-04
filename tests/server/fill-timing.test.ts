import { describe, expect, it } from "vitest";

import {
  ANCHOR_FRESHNESS_SECONDS,
  DEFAULT_FILL_LEAD_MINUTES,
  type FillTimingObservation,
  getFillTimingRateDistribution,
  LIVE_WINDOW_MINUTES,
  MAX_LIVE_WEIGHT,
  MIN_FILL_HORIZON_MINUTES,
  MODEL_VERSION,
  predictFillTiming,
  SEGMENT_GAP_SECONDS,
} from "../../server/lib/fillTiming";

const DEPARTURE_AT = 2_000_000_000;
const ANCHOR_AT = DEPARTURE_AT - 40 * 60;

// build one direct active observation
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

describe("fill-linear-v1", () => {
  // never turn a contradicted departure forecast into certain zero depletion
  it.each([1, 2])(
    "rejects a stale positive prior with only %s receipts",
    (count) => {
      const input = {
        arrivalAt: ANCHOR_AT + 20 * 60,
        asOf: ANCHOR_AT,
        departureEstimate: 40,
        observations: [
          observation(ANCHOR_AT - 60, 35),
          observation(ANCHOR_AT, 30),
        ].slice(-count),
        projectedDepartureAt: DEPARTURE_AT,
      };
      expect(predictFillTiming(input).state).toBe("unavailable");
      expect(getFillTimingRateDistribution(input)).toBeNull();
    }
  );

  // recover using only qualifying live evidence when the departure prior conflicts
  it("uses a live-only slope instead of a contradicted positive prior", () => {
    const input = {
      arrivalAt: ANCHOR_AT + 5 * 60,
      asOf: ANCHOR_AT,
      departureEstimate: 40,
      observations: [
        observation(ANCHOR_AT - 2 * 60, 40),
        observation(ANCHOR_AT - 60, 35),
        observation(ANCHOR_AT, 30),
      ],
      projectedDepartureAt: DEPARTURE_AT,
    };
    expect(predictFillTiming(input)).toMatchObject({
      predictedSpacesAtArrival: 5,
      priorKind: "live-only",
    });
    expect(getFillTimingRateDistribution(input)?.mostLikely).toBe(5);
  });

  // lock every published model constant
  it("exports the reviewed deterministic constants", () => {
    expect(MODEL_VERSION).toBe("fill-linear-v1");
    expect(ANCHOR_FRESHNESS_SECONDS).toBe(180);
    expect(SEGMENT_GAP_SECONDS).toBe(300);
    expect(LIVE_WINDOW_MINUTES).toBe(15);
    expect(MAX_LIVE_WEIGHT).toBe(0.8);
    expect(DEFAULT_FILL_LEAD_MINUTES).toBe(10);
    expect(MIN_FILL_HORIZON_MINUTES).toBe(3);
  });

  // prove the reviewed cold-start numeric example
  it.each([0, 60, 180])(
    "anchors the zero prior instead of restarting it after %s seconds",
    (ageSeconds) => {
      const result = predictFillTiming({
        arrivalAt: DEPARTURE_AT - 20 * 60,
        asOf: ANCHOR_AT + ageSeconds,
        departureEstimate: 0,
        observations: [observation(ANCHOR_AT, 30)],
        projectedDepartureAt: DEPARTURE_AT,
      });

      expect(result).toMatchObject({
        anchorAgeSeconds: ageSeconds,
        anchorAt: ANCHOR_AT,
        fillAt: DEPARTURE_AT - 10 * 60,
        observedSpacesAtAnchor: 30,
        predictedSpacesAtArrival: 10,
        priorKind: "zero-prior",
        state: "available",
      });
    }
  );

  // blend a robust live slope with the cold-start prior
  it("uses the reviewed 15-minute two-space live slope example", () => {
    const result = predictFillTiming({
      arrivalAt: DEPARTURE_AT - 20 * 60,
      asOf: ANCHOR_AT,
      departureEstimate: 0,
      observations: [
        observation(ANCHOR_AT - 15 * 60, 60),
        observation(ANCHOR_AT - 10 * 60, 50),
        observation(ANCHOR_AT - 5 * 60, 40),
        observation(ANCHOR_AT, 30),
      ],
      projectedDepartureAt: DEPARTURE_AT,
    });

    expect(result.fillAt).toBeCloseTo(DEPARTURE_AT - 23 * 60 - 20, 5);
    expect(result.predictedSpacesAtArrival).toBe(0);
    expect(result.confidence).toBe("medium");
  });

  // keep a positive departure point from inventing a predeparture fill
  it("returns nonfill for a positive departure estimate", () => {
    const anchorAt = DEPARTURE_AT - 20 * 60;
    const result = predictFillTiming({
      arrivalAt: DEPARTURE_AT - 5 * 60,
      asOf: anchorAt,
      departureEstimate: 10,
      observations: [observation(anchorAt, 30)],
      projectedDepartureAt: DEPARTURE_AT,
    });

    expect(result).toMatchObject({
      fillAt: null,
      predictedSpacesAtArrival: 15,
      priorKind: "departure-point",
      state: "not-expected-before-departure",
    });
  });

  // distinguish a reported zero from extrapolated exhaustion
  it("returns already-full only for a trustworthy direct zero", () => {
    const result = predictFillTiming({
      arrivalAt: ANCHOR_AT + 5 * 60,
      asOf: ANCHOR_AT,
      departureEstimate: 0,
      observations: [observation(ANCHOR_AT, 0)],
      projectedDepartureAt: DEPARTURE_AT,
    });

    expect(result).toMatchObject({
      fillAt: null,
      fillRange: { earliest: null, latest: ANCHOR_AT },
      predictedSpacesAtArrival: 0,
      priorKind: null,
      state: "already-full",
    });
  });

  // preserve the reported positive-to-zero censoring interval
  it("bounds a reported zero by the last positive receipt", () => {
    const result = predictFillTiming({
      arrivalAt: ANCHOR_AT + 5 * 60,
      asOf: ANCHOR_AT,
      departureEstimate: 0,
      observations: [observation(ANCHOR_AT - 60, 3), observation(ANCHOR_AT, 0)],
      projectedDepartureAt: DEPARTURE_AT,
    });

    expect(result).toMatchObject({
      fillAt: null,
      fillRange: { earliest: ANCHOR_AT - 60, latest: ANCHOR_AT },
      state: "already-full",
    });
  });

  // classify positive-anchor extrapolation separately
  it("returns predicted-full-by-now after a fresh live curve crosses zero", () => {
    const anchorAt = DEPARTURE_AT - 10 * 60;
    const result = predictFillTiming({
      arrivalAt: anchorAt + 2 * 60,
      asOf: anchorAt + 60,
      departureEstimate: null,
      observations: [
        observation(anchorAt - 4.5 * 60, 10),
        observation(anchorAt - 2 * 60, 5),
        observation(anchorAt, 1),
      ],
      projectedDepartureAt: DEPARTURE_AT,
    });

    expect(result).toMatchObject({
      predictedSpacesAtArrival: 0,
      priorKind: "live-only",
      state: "predicted-full-by-now",
    });
    expect(result.fillAt).toBe(anchorAt + 30);
  });

  // keep inactive placeholders out of live evidence
  it("uses inactive all-open observations only as low-confidence priors", () => {
    const result = predictFillTiming({
      arrivalAt: DEPARTURE_AT - 20 * 60,
      asOf: ANCHOR_AT,
      departureEstimate: 0,
      observations: [
        observation(ANCHOR_AT - 15 * 60, 60),
        observation(ANCHOR_AT - 7 * 60, 45),
        observation(ANCHOR_AT, 30, {
          reportingStateAtReceipt: "inactive-all-open",
          usableForFillLabel: false,
        }),
      ],
      projectedDepartureAt: DEPARTURE_AT,
    });

    expect(result).toMatchObject({
      confidence: "low",
      fillAt: DEPARTURE_AT - 10 * 60,
      predictedSpacesAtArrival: 10,
      priorKind: "zero-prior",
    });
  });

  // reject hidden, derived, and stale evidence
  it.each([
    { overrides: { driveUpDisplayed: false }, state: "hidden" },
    { overrides: { sourceKind: "repair-derived" as const }, state: "derived" },
    { age: 181, overrides: {}, state: "stale" },
  ])("returns unavailable for $state evidence", ({ age = 0, overrides }) => {
    const result = predictFillTiming({
      arrivalAt: DEPARTURE_AT - 20 * 60,
      asOf: ANCHOR_AT + age,
      departureEstimate: 0,
      observations: [observation(ANCHOR_AT, 30, overrides)],
      projectedDepartureAt: DEPARTURE_AT,
    });

    expect(result.state).toBe("unavailable");
  });

  // ignore receipts that were unavailable when the estimate was made
  it("ignores observations received after the causal snapshot", () => {
    const result = predictFillTiming({
      arrivalAt: DEPARTURE_AT - 20 * 60,
      asOf: ANCHOR_AT,
      departureEstimate: 0,
      observations: [
        observation(ANCHOR_AT, 30),
        observation(ANCHOR_AT + 60, 0),
      ],
      projectedDepartureAt: DEPARTURE_AT,
    });

    expect(result).toMatchObject({
      anchorAt: ANCHOR_AT,
      observedSpacesAtAnchor: 30,
      state: "available",
    });
  });

  // reject estimates made at or after projected departure
  it("returns unavailable for a departed sailing", () => {
    const result = predictFillTiming({
      arrivalAt: DEPARTURE_AT,
      asOf: DEPARTURE_AT,
      departureEstimate: 0,
      observations: [observation(DEPARTURE_AT - 1, 0)],
      projectedDepartureAt: DEPARTURE_AT,
    });

    expect(result.state).toBe("unavailable");
  });

  // reset live evidence after every segment discontinuity
  it.each([
    {
      observations: [
        observation(ANCHOR_AT - 7 * 60, 45),
        observation(ANCHOR_AT - 60, 35),
        observation(ANCHOR_AT, 30),
      ],
      state: "receipt gap",
    },
    {
      observations: [
        observation(ANCHOR_AT - 3 * 60, 45),
        observation(ANCHOR_AT - 2 * 60, 35, { vesselId: "16" }),
        observation(ANCHOR_AT, 30, { vesselId: "16" }),
      ],
      state: "vessel change",
    },
    {
      observations: [
        observation(ANCHOR_AT - 3 * 60, 45),
        observation(ANCHOR_AT - 2 * 60, 35, { maxSpaceCount: 100 }),
        observation(ANCHOR_AT, 30, { maxSpaceCount: 100 }),
      ],
      state: "capacity change",
    },
    {
      observations: [
        observation(ANCHOR_AT - 3 * 60, 2),
        observation(ANCHOR_AT - 2 * 60, 0),
        observation(ANCHOR_AT, 8),
      ],
      state: "count increase",
    },
  ])("starts a new segment after a $state", ({ observations }) => {
    const result = predictFillTiming({
      arrivalAt: DEPARTURE_AT - 10 * 60,
      asOf: ANCHOR_AT,
      departureEstimate: null,
      observations,
      projectedDepartureAt: DEPARTURE_AT,
    });

    expect(result.state).toBe("unavailable");
  });
});
