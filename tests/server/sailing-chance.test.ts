import { describe, expect, it } from "vitest";

import {
  type FillTimingObservation,
  type FillTimingRateDistribution,
  getFillTimingRateDistribution,
  predictFillTiming,
} from "../../server/lib/fillTiming";
import {
  createTravelUncertainty,
  estimateSailingChance,
  MAX_MODELED_BUFFER_MINUTES,
  TRAVEL_QUANTILE_COUNT,
} from "../../server/lib/sailingChance";
import type {
  FillTimingCapacity,
  TravelUncertainty,
} from "../../shared/contracts/sailingRecommendations";

const DEPARTURE_AT = 2_000_000_000;
const ANCHOR_AT = DEPARTURE_AT - 40 * 60;

// create one capacity result with explicit state
const capacity = (
  state: FillTimingCapacity["state"] = "available"
): FillTimingCapacity => ({
  anchorAgeSeconds: 0,
  anchorAt: ANCHOR_AT,
  confidence: "low",
  fillAt: null,
  fillRange: null,
  modelVersion: "fill-linear-v1",
  observedSpacesAtAnchor: state === "already-full" ? 0 : 30,
  predictedSpacesAtArrival: state === "already-full" ? 0 : 10,
  priorKind: state === "already-full" ? null : "zero-prior",
  state,
});

// create one symmetric travel prior for probability examples
const travel = (
  earliestArrivalAt = 0,
  latestArrivalAt = 100
): TravelUncertainty => ({
  earliestArrivalAt,
  latestArrivalAt,
  modelVersion: "triangular-travel-v1",
  widthSeconds: (latestArrivalAt - earliestArrivalAt) / 2,
});

// create one direct active fill observation
const observation = (
  receivedAt: number,
  driveUpSpaces: number
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
});

const POINT_RATE: FillTimingRateDistribution = {
  anchorAt: 0,
  maximum: 1,
  minimum: 1,
  mostLikely: 1,
  spacesAtAnchor: 50 / 60,
};

describe("travel uncertainty", () => {
  // lock the assumed prior and traffic-unaware widening
  it("derives deterministic triangular bounds", () => {
    expect(
      createTravelUncertainty({
        durationSeconds: 600,
        mode: "drive",
        routeRequestedAt: 1_000,
        staticDurationSeconds: 480,
        trafficAware: true,
      })
    ).toEqual({
      earliestArrivalAt: 1_480,
      latestArrivalAt: 1_720,
      modelVersion: "triangular-travel-v1",
      widthSeconds: 120,
    });
    expect(
      createTravelUncertainty({
        durationSeconds: 600,
        mode: "drive",
        routeRequestedAt: 1_000,
        staticDurationSeconds: 480,
        trafficAware: false,
      })
    ).toEqual({
      earliestArrivalAt: 1_300,
      latestArrivalAt: 1_900,
      modelVersion: "triangular-travel-v1",
      widthSeconds: 300,
    });
  });
});

describe("fill timing rate distribution", () => {
  // expose the exact rate prior already used by fill-linear-v1
  it("returns the same fresh anchor and rate range", () => {
    expect(
      getFillTimingRateDistribution({
        arrivalAt: DEPARTURE_AT - 20 * 60,
        asOf: ANCHOR_AT,
        departureEstimate: 0,
        observations: [observation(ANCHOR_AT, 30)],
        projectedDepartureAt: DEPARTURE_AT,
      })
    ).toEqual({
      anchorAt: ANCHOR_AT,
      maximum: 1.5,
      minimum: 0.5,
      mostLikely: 1,
      spacesAtAnchor: 30,
    });
  });

  // keep stale and direct-zero states out of the rate prior
  it("returns null without a usable uncertain rate", () => {
    expect(
      getFillTimingRateDistribution({
        arrivalAt: DEPARTURE_AT - 20 * 60,
        asOf: ANCHOR_AT + 181,
        departureEstimate: 0,
        observations: [observation(ANCHOR_AT, 30)],
        projectedDepartureAt: DEPARTURE_AT,
      })
    ).toBeNull();
    expect(
      getFillTimingRateDistribution({
        arrivalAt: DEPARTURE_AT - 20 * 60,
        asOf: ANCHOR_AT,
        departureEstimate: 0,
        observations: [observation(ANCHOR_AT, 0)],
        projectedDepartureAt: DEPARTURE_AT,
      })
    ).toBeNull();
  });

  // retain unknown capacity when a delayed sailing loses fresh upstream reports
  it("expires the delayed Tokitae capacity without losing its timing chance", () => {
    const observations = [
      [-660, 78],
      [-600, 58],
      [-540, 58],
      [-480, 58],
      [-420, 58],
      [-300, 42],
      [-240, 42],
      [-180, 42],
      [-120, 42],
      [0, 26],
      [60, 26],
      [120, 26],
      [180, 26],
      [240, 26],
    ].map(
      // replay sanitized receipts relative to the scheduled departure
      ([offset, spaces]) => ({
        ...observation(DEPARTURE_AT + offset, spaces),
        maxSpaceCount: 141,
        vesselId: "68",
      })
    );
    const arrivalAt = DEPARTURE_AT + 19 * 60;
    const projectedDepartureAt = DEPARTURE_AT + 41 * 60;
    // keep travel and inventory snapshots separate across the freshness boundary
    const assessAt = (anchorAgeSeconds: number) => {
      const input = {
        arrivalAt,
        asOf: DEPARTURE_AT + 240 + anchorAgeSeconds,
        departureEstimate: 21,
        observations,
        projectedDepartureAt,
      };
      const capacity = predictFillTiming(input);
      const rateDistribution = getFillTimingRateDistribution(input);
      return {
        capacity,
        rateDistribution,
        ...estimateSailingChance({
          arrivalAt,
          capacity,
          eligibilityReason: null,
          latestArrivalAt: projectedDepartureAt,
          mode: "drive",
          rateDistribution,
          travelUncertainty: travel(arrivalAt - 120, arrivalAt + 120),
        }),
      };
    };
    const fresh = assessAt(180);
    expect(fresh.capacity.state).toBe("available");
    expect(fresh.rateDistribution).not.toBeNull();
    expect(fresh.chance.probabilities[5]).toBeCloseTo(0.951244278798277, 12);
    expect(fresh.chance.timingProbabilities[5]).toBe(1);
    // stale capacity never becomes a fabricated boarding chance or hard zero
    for (const age of [181, 240]) {
      const stale = assessAt(age);
      expect(stale.capacity.state).toBe("unavailable");
      expect(stale.rateDistribution).toBeNull();
      expect(stale.chance.probabilities[5]).toBeNull();
      expect(stale.chance.timingProbabilities[5]).toBe(1);
    }
  });
});

describe("joint-triangular-v1", () => {
  // integrate the same arrival into timing and capacity instead of multiplying marginals
  it("keeps the positively correlated joint chance near one half", () => {
    const result = estimateSailingChance({
      arrivalAt: 50,
      capacity: capacity(),
      eligibilityReason: null,
      latestArrivalAt: 50,
      mode: "drive",
      rateDistribution: POINT_RATE,
      travelUncertainty: travel(),
    });
    const joint = result.chance.probabilities[0] as number;
    const product =
      result.chance.timingProbabilities[0] *
      (result.chance.capacityProbability as number);

    expect(joint).toBeCloseTo(50 / TRAVEL_QUANTILE_COUNT, 12);
    expect(product).toBeCloseTo(2_550 / TRAVEL_QUANTILE_COUNT ** 2, 12);
    expect(joint).toBeGreaterThan(product + 0.2);
  });

  // distinguish unknown driver capacity from structural and observed hard zeroes
  it("preserves null and deterministic zero outcomes", () => {
    const base = {
      arrivalAt: 50,
      eligibilityReason: null,
      latestArrivalAt: 50,
      mode: "drive" as const,
      travelUncertainty: travel(),
    };
    const unknown = estimateSailingChance({
      ...base,
      capacity: null,
      rateDistribution: null,
    });
    const cancelled = estimateSailingChance({
      ...base,
      capacity: null,
      eligibilityReason: "cancelled",
      rateDistribution: null,
    });
    const full = estimateSailingChance({
      ...base,
      capacity: capacity("already-full"),
      rateDistribution: null,
    });

    expect(unknown.chance.probabilities).toHaveLength(
      MAX_MODELED_BUFFER_MINUTES + 1
    );
    expect(unknown.chance.probabilities.every((value) => value === null)).toBe(
      true
    );
    expect(cancelled.chance.probabilities.every((value) => value === 0)).toBe(
      true
    );
    expect(cancelled.chance.timingProbabilities[0]).toBeCloseTo(
      51 / TRAVEL_QUANTILE_COUNT,
      12
    );
    expect(cancelled.chance.capacityProbability).toBeNull();
    expect(full.chance.probabilities.every((value) => value === 0)).toBe(true);
    expect(full.chance.timingProbabilities[0]).toBeCloseTo(
      51 / TRAVEL_QUANTILE_COUNT,
      12
    );
    expect(full.chance.capacityProbability).toBe(0);
    expect(full.spacesAtArrivalRange).toEqual({ maximum: 0, minimum: 0 });
  });

  // ignore all capacity inputs for walk, bicycle and transit riders
  it.each(["walk", "bicycle", "transit"] as const)(
    "uses timing only for %s",
    (mode) => {
      const result = estimateSailingChance({
        arrivalAt: 50,
        capacity: capacity("already-full"),
        eligibilityReason: null,
        latestArrivalAt: 50,
        mode,
        rateDistribution: POINT_RATE,
        travelUncertainty: travel(),
      });

      expect(result.chance.basis).toBe("timing-only");
      expect(result.chance.capacityProbability).toBeNull();
      expect(result.chance.probabilities).toEqual(
        result.chance.timingProbabilities
      );
      expect(result.spacesAtArrivalRange).toBeNull();
    }
  );

  // retain an early-tail chance after the point arrival has reached zero spaces
  it("models early arrivals when the point estimate is full", () => {
    const result = estimateSailingChance({
      arrivalAt: 50,
      capacity: capacity("predicted-full-by-now"),
      eligibilityReason: null,
      latestArrivalAt: 50,
      mode: "drive",
      rateDistribution: {
        ...POINT_RATE,
        spacesAtAnchor: 30 / 60,
      },
      travelUncertainty: travel(),
    });

    expect(result.spacesAtArrivalRange).toEqual({ maximum: 0.5, minimum: 0 });
    expect(result.chance.probabilities[0]).toBeGreaterThan(0);
    expect(result.chance.probabilities[0]).toBeLessThan(0.5);
  });

  // keep buffer chance monotone without changing the capacity-only marginal
  it("applies buffers only to the timing cutoff", () => {
    const input = {
      arrivalAt: 1_200,
      capacity: capacity(),
      eligibilityReason: null,
      mode: "drive" as const,
      rateDistribution: {
        anchorAt: 0,
        maximum: 1.5,
        minimum: 0.5,
        mostLikely: 1,
        spacesAtAnchor: 25,
      },
      travelUncertainty: travel(0, 2_400),
    };
    const result = estimateSailingChance({
      ...input,
      latestArrivalAt: 1_800,
    });
    const shiftedCutoff = estimateSailingChance({
      ...input,
      latestArrivalAt: 2_100,
    });

    // compare every later buffer with its predecessor
    for (
      let index = 1;
      index < result.chance.probabilities.length;
      index += 1
    ) {
      expect(result.chance.probabilities[index] as number).toBeLessThanOrEqual(
        result.chance.probabilities[index - 1] as number
      );
      expect(result.chance.timingProbabilities[index]).toBeLessThanOrEqual(
        result.chance.timingProbabilities[index - 1]
      );
    }
    expect(result.chance.capacityProbability).toBe(
      shiftedCutoff.chance.capacityProbability
    );
  });

  // combine the full travel and rate supports into a deterministic space range
  it("returns finite combined-support spaces and stable repeated results", () => {
    const input = {
      arrivalAt: 600,
      capacity: capacity(),
      eligibilityReason: null,
      latestArrivalAt: 900,
      mode: "drive" as const,
      rateDistribution: {
        anchorAt: 0,
        maximum: 3,
        minimum: 1,
        mostLikely: 2,
        spacesAtAnchor: 40,
      },
      travelUncertainty: travel(300, 900),
    };
    const first = estimateSailingChance(input);
    const second = estimateSailingChance(input);

    expect(first).toEqual(second);
    expect(first.spacesAtArrivalRange).toEqual({ maximum: 35, minimum: 0 });
    expect(Number.isFinite(first.spacesAtArrivalRange?.minimum)).toBe(true);
    expect(Number.isFinite(first.spacesAtArrivalRange?.maximum)).toBe(true);
  });
});

describe("forecast capacity fallback", () => {
  // estimate every buffer from forecast fullness when inventory is unavailable
  it.each([0, 0.2, 0.8, 1])(
    "uses full probability %s without a live anchor",
    (forecastFullProbability) => {
      const result = estimateSailingChance({
        arrivalAt: 50,
        capacity: null,
        eligibilityReason: null,
        forecastFullProbability,
        latestArrivalAt: 75,
        mode: "drive",
        rateDistribution: null,
        travelUncertainty: travel(),
      });
      expect(result.chance.forecastFullProbability).toBe(
        forecastFullProbability
      );
      expect(result.chance.capacityProbability).toBe(
        1 - forecastFullProbability
      );
      expect(result.chance.probabilities).toEqual(
        result.chance.timingProbabilities.map(
          (timing) => timing * (1 - forecastFullProbability)
        )
      );
      expect(result.chance.depletionRateRange).toBeNull();
      expect(result.spacesAtArrivalRange).toBeNull();
    }
  );

  // never let favorable forecasts override a departed sailing or observed zero
  it.each(["drive", "walk", "bicycle", "transit"] as const)(
    "keeps departed %s chances zero for all buffers",
    (mode) => {
      const result = estimateSailingChance({
        arrivalAt: 50,
        capacity: capacity(),
        eligibilityReason: "departed",
        forecastFullProbability: 0,
        latestArrivalAt: 10_000,
        mode,
        rateDistribution: POINT_RATE,
        travelUncertainty: travel(),
      });
      expect(result.chance.probabilities).toEqual(Array(61).fill(0));
      expect(result.chance.forecastFullProbability).toBeUndefined();
    }
  );

  // authoritative inventory remains primary even against opposite forecasts
  it("preserves live joint chances and directly observed fullness", () => {
    const input = {
      arrivalAt: 50,
      capacity: capacity(),
      eligibilityReason: null,
      latestArrivalAt: 75,
      mode: "drive" as const,
      rateDistribution: POINT_RATE,
      travelUncertainty: travel(),
    };
    expect(
      estimateSailingChance({ ...input, forecastFullProbability: 1 })
    ).toEqual(estimateSailingChance(input));
    const full = estimateSailingChance({
      ...input,
      capacity: capacity("already-full"),
      forecastFullProbability: 0,
    });
    expect(full.chance.probabilities).toEqual(Array(61).fill(0));
    expect(full.chance.forecastFullProbability).toBeUndefined();
  });

  // missing or invalid forecasts are not fabricated into success
  it.each([undefined, NaN, Infinity, -0.1, 1.1])(
    "keeps invalid full probability %s unknown",
    (forecastFullProbability) => {
      expect(
        estimateSailingChance({
          arrivalAt: 50,
          capacity: null,
          eligibilityReason: null,
          forecastFullProbability,
          latestArrivalAt: 75,
          mode: "drive",
          rateDistribution: null,
          travelUncertainty: travel(),
        }).chance.probabilities
      ).toEqual(Array(61).fill(null));
    }
  );
});

// vehicle forecasts do not limit passenger-only travel
it.each(["walk", "bicycle", "transit"] as const)(
  "ignores forecast fullness for %s",
  (mode) => {
    const result = estimateSailingChance({
      arrivalAt: 50,
      capacity: null,
      eligibilityReason: null,
      forecastFullProbability: 1,
      latestArrivalAt: 75,
      mode,
      rateDistribution: null,
      travelUncertainty: travel(),
    });
    expect(result.chance.probabilities).toEqual(
      result.chance.timingProbabilities
    );
    expect(result.chance.forecastFullProbability).toBeUndefined();
  }
);
