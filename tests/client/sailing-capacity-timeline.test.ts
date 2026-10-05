import type {
  FillTimingCapacity,
  SailingAssessment,
} from "shared/contracts/sailingRecommendations";
import { describe, expect, it } from "vitest";

import {
  buildSailingCapacityTimeline,
  type TimelineSailing,
} from "../../client/lib/sailingCapacityTimeline";

const START = 1_000;
const TEN_MINUTES = 600;

// build a complete live capacity source with independently configurable rates
const capacity = (
  spaces: number,
  totalSpaces: number,
  rate: { minimum: number; mostLikely: number; maximum: number },
  overrides: Partial<FillTimingCapacity> = {}
): FillTimingCapacity => ({
  anchorAgeSeconds: 0,
  anchorAt: START,
  confidence: "medium",
  fillAt: null,
  fillRange: null,
  modelVersion: "fill-linear-v1",
  observedSpacesAtAnchor: spaces,
  predictedSpacesAtArrival: spaces,
  priorKind: "live-only",
  projection: { rate, totalSpaces },
  state: "available",
  ...overrides,
});

// build a chronological sailing while keeping test differences explicit
const sailing = (
  id: string | undefined,
  departureAt: number,
  sailingCapacity: FillTimingCapacity | null,
  eligibilityReason: SailingAssessment["eligibilityReason"] = null
): TimelineSailing => ({
  sailingId: id,
  capacity: sailingCapacity,
  eligibilityReason,
  meetsOperatorAdvice: true,
  operatorAdviceSeconds: 1_200,
  operatorCutoffSeconds: 180,
  projectedDepartureAt: departureAt,
  scheduledDepartureAt: departureAt,
  timingAssessment: "normal",
  vesselName: id ?? "Fallback vessel",
});

// read a percentage at a segment boundary without hiding missing samples
const boundary = (
  values: { at: number; percent: number }[],
  edge: "first" | "last"
): number | undefined =>
  edge === "first" ? values[0]?.percent : values.at(-1)?.percent;

describe("sailing capacity timeline", () => {
  // each new boat starts empty after a preceding boat that retained capacity
  it("resets partial sailings to zero and uses each sailing's own rate", () => {
    const series = buildSailingCapacityTimeline(
      [
        sailing(
          "first",
          START + TEN_MINUTES,
          capacity(100, 100, { minimum: 4, mostLikely: 5, maximum: 6 })
        ),
        sailing(
          "second",
          START + TEN_MINUTES * 2,
          capacity(12, 80, { minimum: 1, mostLikely: 2, maximum: 3 })
        ),
        sailing(
          "third",
          START + TEN_MINUTES * 3,
          capacity(9, 100, { minimum: 1, mostLikely: 4, maximum: 5 })
        ),
      ],
      START,
      START + TEN_MINUTES * 3
    );

    expect(series.map((item) => item.key)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(boundary(series[0].mean, "first")).toBe(0);
    expect(boundary(series[0].mean, "last")).toBe(50);
    expect(boundary(series[1].mean, "first")).toBe(0);
    expect(boundary(series[1].mean, "last")).toBe(25);
    expect(boundary(series[2].mean, "first")).toBe(0);
    expect(boundary(series[2].mean, "last")).toBe(40);
    expect(series.map((item) => item.modelBasis)).toEqual([
      "live",
      "departure-reset",
      "departure-reset",
    ]);
  });

  // unserved demand from a full boat consumes the next boat at its departure
  it("carries a full sailing's modeled excess into the next sailing", () => {
    const series = buildSailingCapacityTimeline(
      [
        sailing(
          "first",
          START + TEN_MINUTES,
          capacity(20, 100, { minimum: 4, mostLikely: 5, maximum: 6 })
        ),
        sailing(
          "second",
          START + TEN_MINUTES * 2,
          capacity(80, 100, { minimum: 1, mostLikely: 2, maximum: 3 })
        ),
      ],
      START,
      START + TEN_MINUTES * 2
    );

    expect(boundary(series[1].mean, "first")).toBeCloseTo(30);
    expect(boundary(series[1].mean, "last")).toBeCloseTo(50);
    expect(series[0].mean.some((point) => point.at === START + 240)).toBe(true);
  });

  // backlog stays uncapped internally so it can overflow more than one vessel
  it("preserves overflow larger than one boat into a third sailing", () => {
    const series = buildSailingCapacityTimeline(
      [
        sailing(
          "first",
          START + TEN_MINUTES,
          capacity(10, 100, { minimum: 25, mostLikely: 25, maximum: 25 })
        ),
        sailing(
          "second",
          START + TEN_MINUTES * 2,
          capacity(10, 100, { minimum: 5, mostLikely: 5, maximum: 5 })
        ),
        sailing(
          "third",
          START + TEN_MINUTES * 3,
          capacity(10, 100, { minimum: 1, mostLikely: 1, maximum: 1 })
        ),
      ],
      START,
      START + TEN_MINUTES * 3
    );

    expect(boundary(series[1].mean, "first")).toBe(100);
    expect(boundary(series[2].mean, "first")).toBe(100);
    expect(series[1].fullAt).toBe(START + TEN_MINUTES);
    expect(series[2].fullAt).toBe(START + TEN_MINUTES * 2);
  });

  // missing live inventory cannot erase a later sailing's own direct model
  it.each([
    ["missing", null],
    [
      "forecast-only",
      capacity(
        50,
        100,
        { minimum: 1, mostLikely: 2, maximum: 3 },
        {
          projection: undefined,
        }
      ),
    ],
    [
      "unavailable",
      capacity(
        50,
        100,
        { minimum: 1, mostLikely: 2, maximum: 3 },
        {
          state: "unavailable",
        }
      ),
    ],
  ])(
    "keeps %s capacity unknown while recovering its successor",
    (_name, firstCapacity) => {
      const series = buildSailingCapacityTimeline(
        [
          sailing("first", START + TEN_MINUTES, firstCapacity),
          sailing(
            "second",
            START + TEN_MINUTES * 2,
            capacity(100, 100, { minimum: 1, mostLikely: 2, maximum: 3 })
          ),
        ],
        START,
        START + TEN_MINUTES * 2
      );

      expect(series[0].mean).toEqual([]);
      expect(series[0].modelBasis).toBe("unknown");
      expect(series[1].mean.length).toBeGreaterThan(0);
      expect(series[1].modelBasis).toBe("live");
      expect(boundary(series[1].mean, "first")).toBeCloseTo(20);
      expect(series[1].fullAt).toBeNull();
      expect(series[1].fillRange).toBeNull();
    }
  );

  // a forecast-only middle sailing cannot suppress a later direct observation
  it("recovers a later live model after a forecast-only middle sailing", () => {
    const forecastOnly = capacity(
      50,
      100,
      { minimum: 1, mostLikely: 2, maximum: 3 },
      { projection: undefined, state: "unavailable" }
    );
    const series = buildSailingCapacityTimeline(
      [
        sailing(
          "first",
          START + TEN_MINUTES,
          capacity(100, 100, { minimum: 1, mostLikely: 2, maximum: 3 })
        ),
        sailing("forecast", START + TEN_MINUTES * 2, forecastOnly),
        sailing(
          "third",
          START + TEN_MINUTES * 3,
          capacity(70, 100, { minimum: 1, mostLikely: 2, maximum: 3 })
        ),
      ],
      START,
      START + TEN_MINUTES * 3
    );

    expect(series.map((item) => item.modelBasis)).toEqual([
      "live",
      "unknown",
      "live",
    ]);
    expect(series[1].mean).toEqual([]);
    expect(boundary(series[2].mean, "first")).toBeCloseTo(70);
    expect(boundary(series[2].mean, "last")).toBeCloseTo(90);
  });

  // a direct full report proves current fullness but not queue depth to carry forward
  it("plots a direct-full source and recovers the following live model", () => {
    const directFull = capacity(
      0,
      100,
      { minimum: 0, mostLikely: 0, maximum: 0 },
      { fillAt: START, state: "already-full" }
    );
    const series = buildSailingCapacityTimeline(
      [
        sailing("first", START + TEN_MINUTES, directFull),
        sailing(
          "second",
          START + TEN_MINUTES * 2,
          capacity(100, 100, { minimum: 1, mostLikely: 2, maximum: 3 })
        ),
      ],
      START,
      START + TEN_MINUTES * 2
    );

    expect(series[0].mean.length).toBeGreaterThan(0);
    expect(series[0].mean.every((point) => point.percent === 100)).toBe(true);
    expect(series[0].fullAt).toBe(START);
    expect(series[1].mean.length).toBeGreaterThan(0);
    expect(series[1].modelBasis).toBe("live");
    expect(boundary(series[1].mean, "first")).toBeCloseTo(20);
  });

  // a later direct-full report establishes occupancy without claiming queue depth
  it("plots a later direct-full sailing and recovers the following live model", () => {
    const directFull = capacity(
      0,
      100,
      { minimum: 0, mostLikely: 0, maximum: 0 },
      { state: "already-full" }
    );
    const series = buildSailingCapacityTimeline(
      [
        sailing(
          "first",
          START + TEN_MINUTES,
          capacity(100, 100, { minimum: 1, mostLikely: 2, maximum: 3 })
        ),
        sailing("second", START + TEN_MINUTES * 2, directFull),
        sailing(
          "third",
          START + TEN_MINUTES * 3,
          capacity(100, 100, { minimum: 1, mostLikely: 2, maximum: 3 })
        ),
      ],
      START,
      START + TEN_MINUTES * 3
    );

    expect(series[0].mean.length).toBeGreaterThan(0);
    expect(series[1].mean.length).toBeGreaterThan(0);
    expect(series[1].mean.every((point) => point.percent === 100)).toBe(true);
    expect(series[1].modelBasis).toBe("live");
    expect(series[1].fullAt).toBeNull();
    expect(series[2].mean.length).toBeGreaterThan(0);
    expect(series[2].modelBasis).toBe("live");
  });

  // elapsed sailings stay present for selection but cannot seed a capacity curve
  it("keeps departed models unknown rather than extrapolating them", () => {
    const series = buildSailingCapacityTimeline(
      [
        sailing(
          "departed",
          START + TEN_MINUTES,
          capacity(100, 100, { minimum: 1, mostLikely: 2, maximum: 3 }),
          "departed"
        ),
        sailing(
          "next",
          START + TEN_MINUTES * 2,
          capacity(100, 100, { minimum: 1, mostLikely: 2, maximum: 3 })
        ),
      ],
      START,
      START + TEN_MINUTES * 2
    );

    expect(series).toHaveLength(2);
    expect(series[0].mean).toEqual([]);
    expect(series[0].modelBasis).toBe("unknown");
    expect(series[1].mean.length).toBeGreaterThan(0);
    expect(series[1].modelBasis).toBe("live");
  });

  // published first-sailing timing remains one-sided instead of gaining a synthetic bound
  it("preserves the first sailing's published missing fill bounds", () => {
    const firstCapacity = capacity(
      100,
      100,
      { minimum: 1, mostLikely: 2, maximum: 3 },
      {
        fillAt: null,
        fillRange: { earliest: START + 300, latest: null },
      }
    );
    const [first] = buildSailingCapacityTimeline(
      [sailing("first", START + TEN_MINUTES, firstCapacity)],
      START,
      START + TEN_MINUTES
    );

    expect(first.fullAt).toBeNull();
    expect(first.fillRange).toEqual({
      earliest: START + 300,
      latest: null,
    });
  });

  // every sampled area stops at its own departure or the shared chart boundary
  it("clips each independent area to its own segment and the requested window", () => {
    const series = buildSailingCapacityTimeline(
      [
        sailing(
          "first",
          START + TEN_MINUTES,
          capacity(100, 100, { minimum: 1, mostLikely: 2, maximum: 3 })
        ),
        sailing(
          "second",
          START + TEN_MINUTES * 2,
          capacity(100, 100, { minimum: 1, mostLikely: 2, maximum: 3 })
        ),
        sailing(
          "third",
          START + TEN_MINUTES * 3,
          capacity(100, 100, { minimum: 1, mostLikely: 2, maximum: 3 })
        ),
      ],
      START,
      START + TEN_MINUTES * 2.5
    );

    expect(series.map((item) => [item.from, item.to])).toEqual([
      [START, START + TEN_MINUTES],
      [START + TEN_MINUTES, START + TEN_MINUTES * 2],
      [START + TEN_MINUTES * 2, START + TEN_MINUTES * 2.5],
    ]);
    expect(series.map((item) => item.mean.at(-1)?.at)).toEqual([
      START + TEN_MINUTES,
      START + TEN_MINUTES * 2,
      START + TEN_MINUTES * 2.5,
    ]);
  });

  // zero-width simultaneous departures stay explicit while ineligible sailings disappear
  it("sorts sailings, skips excluded eligibility and keeps same-time segments empty", () => {
    const live = capacity(100, 100, {
      minimum: 1,
      mostLikely: 2,
      maximum: 3,
    });
    const series = buildSailingCapacityTimeline(
      [
        sailing("later", START + TEN_MINUTES * 2, live),
        sailing("cancelled", START + TEN_MINUTES * 1.5, live, "cancelled"),
        sailing("first", START + TEN_MINUTES, live),
        sailing(undefined, START + TEN_MINUTES, live),
        sailing(
          "wrong-mode",
          START + TEN_MINUTES * 1.75,
          live,
          "mode-ineligible"
        ),
      ],
      START,
      START + TEN_MINUTES * 2
    );

    expect(series.map((item) => item.key)).toEqual([
      "first",
      `${START + TEN_MINUTES}:Fallback vessel`,
      "later",
    ]);
    expect(series[1].from).toBe(START + TEN_MINUTES);
    expect(series[1].to).toBe(START + TEN_MINUTES);
    expect(series[1].mean).toEqual([]);
    expect(series[1].modelBasis).toBe("live");
    expect(series[2].from).toBe(START + TEN_MINUTES);
    expect(series[2].modelBasis).toBe("departure-reset");
  });

  // invalid denominators and rates cannot create percentages or downstream carryover
  it.each([
    ["zero denominator", { totalSpaces: 0 }],
    ["negative rate", { rate: { minimum: -1, mostLikely: 1, maximum: 2 } }],
    ["unordered rates", { rate: { minimum: 2, mostLikely: 1, maximum: 3 } }],
  ])("rejects a %s", (_name, projectionOverride) => {
    const invalid = capacity(100, 100, {
      minimum: 1,
      mostLikely: 2,
      maximum: 3,
    });
    invalid.projection = {
      ...invalid.projection!,
      ...projectionOverride,
    };
    const series = buildSailingCapacityTimeline(
      [
        sailing("first", START + TEN_MINUTES, invalid),
        sailing(
          "second",
          START + TEN_MINUTES * 2,
          capacity(100, 100, { minimum: 1, mostLikely: 2, maximum: 3 })
        ),
      ],
      START,
      START + TEN_MINUTES * 2
    );

    expect(series[0].mean).toEqual([]);
    expect(series[0].modelBasis).toBe("unknown");
    expect(series[1].mean.length).toBeGreaterThan(0);
    expect(series[1].modelBasis).toBe("live");
  });
});
