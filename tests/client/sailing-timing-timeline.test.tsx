// @vitest-environment jsdom
import { DateTime } from "luxon";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  FillTimingCapacity,
  RecommendedSailing,
} from "shared/contracts/sailingRecommendations";
import { describe, expect, it } from "vitest";

import { SailingTimingTimeline } from "../../client/views/Schedule/SailingTimingTimeline";

const NOW = DateTime.fromISO("2026-10-05T13:00:00", {
  zone: "America/Los_Angeles",
}).toSeconds();
const capacity: FillTimingCapacity = {
  anchorAt: NOW,
  anchorAgeSeconds: 0,
  confidence: "medium",
  fillAt: NOW + 1800,
  fillRange: { earliest: NOW + 1500, latest: NOW + 2100 },
  modelVersion: "fill-linear-v1",
  observedSpacesAtAnchor: 30,
  predictedSpacesAtArrival: 15,
  priorKind: "departure-point",
  projection: {
    totalSpaces: 100,
    rate: { minimum: 6 / 7, mostLikely: 1, maximum: 1.2 },
  },
  state: "available",
};
const sailing: RecommendedSailing = {
  capacity,
  meetsOperatorAdvice: true,
  operatorAdviceSeconds: 1200,
  operatorCutoffSeconds: 180,
  projectedDepartureAt: NOW + 2700,
  scheduledDepartureAt: NOW + 2400,
  timingAssessment: "normal",
  vesselName: "Test vessel",
};
const defaults = {
  now: NOW,
  arrivalAt: NOW + 1200,
  sailing,
  travelUncertainty: {
    earliestArrivalAt: NOW + 900,
    latestArrivalAt: NOW + 1500,
    modelVersion: "triangular-travel-v1" as const,
    widthSeconds: 300,
  },
};

type RenderOverrides = Partial<
  React.ComponentProps<typeof SailingTimingTimeline>
> & {
  capacity?: FillTimingCapacity | null;
  subsequentSailing?: RecommendedSailing | null;
};

// adapt historical two-sailing fixtures to the fixed multi-sailing chart contract
const render = (overrides: RenderOverrides = {}): HTMLDivElement => {
  const {
    capacity: suppliedCapacity,
    subsequentSailing,
    sailings,
    ...props
  } = overrides;
  const selected = props.sailing ?? sailing;
  // retain distinct identities when adapting older two-sailing fixtures
  const first = {
    ...selected,
    sailingId: selected.sailingId ?? "fixture-first",
    capacity:
      suppliedCapacity === undefined ? selected.capacity : suppliedCapacity,
  };
  const following =
    subsequentSailing &&
    subsequentSailing.projectedDepartureAt > selected.projectedDepartureAt &&
    subsequentSailing.projectedDepartureAt > (props.now ?? NOW)
      ? [
          {
            ...subsequentSailing,
            sailingId: subsequentSailing.sailingId ?? "fixture-next",
          },
        ]
      : [];
  const element = document.createElement("div");
  element.innerHTML = renderToStaticMarkup(
    <SailingTimingTimeline
      {...defaults}
      {...props}
      sailings={sailings ?? [first, ...following]}
    />
  );
  return element;
};

// retain each exact source timestamp independently from label collision avoidance
const times = (element: HTMLDivElement): Record<string, number> =>
  Object.fromEntries(
    Array.from(element.querySelectorAll("[data-timeline-point]")).map(
      (point) => [
        point.getAttribute("data-timeline-point"),
        Number(point.getAttribute("data-time")),
      ]
    )
  );

describe("expanded trip timing timeline", () => {
  // compare one arrival and the selected boarding cutoff directly against capacity
  it("uses dotted vertical ETA and cutoff markers without You or capacity-axis labels", () => {
    const element = render();
    const svg = element.querySelector("svg")!;
    const top = Number(svg.getAttribute("data-graph-top"));
    const bottom = Number(svg.getAttribute("data-graph-bottom"));
    expect(
      element.querySelectorAll('[data-axis-label="capacity"]')
    ).toHaveLength(0);
    const arrival = element.querySelector('[data-timeline-lane="arrival"]')!;
    expect(
      arrival.querySelectorAll(
        "[data-timeline-point], [data-timeline-label], [data-lane-caption]"
      )
    ).toHaveLength(0);
    const eta = element.querySelector("[data-arrival-marker]")!;
    const cutoff = element.querySelector("[data-cutoff-marker]")!;
    // both comparison markers retain their true timestamps on the full-height graph
    for (const [marker, at, color] of [
      [eta, defaults.arrivalAt, "text-gray-dark"],
      [
        cutoff,
        sailing.projectedDepartureAt - sailing.operatorCutoffSeconds,
        "text-sky-700",
      ],
    ] as const) {
      expect(marker).not.toBeNull();
      expect(Number(marker.getAttribute("data-time"))).toBe(at);
      expect(marker.getAttribute("class")).toContain(color);
      expect(marker.getAttribute("stroke-dasharray")).toBe("1 5");
      expect(Number(marker.getAttribute("y1"))).toBe(top);
      expect(Number(marker.getAttribute("y2"))).toBe(bottom);
      expect(marker.getAttribute("x1")).toBe(marker.getAttribute("x2"));
    }
    const label = element.querySelector("[data-arrival-caption]")!;
    expect(label.textContent).toBe("ETA");
    expect(label.getAttribute("text-anchor")).toBe("middle");
    expect(label.getAttribute("transform")).toMatch(/^rotate\(-90 /);
    expect(Number(label.getAttribute("y"))).toBe((top + bottom) / 2);
  });

  // selection changes only the active blue timeline, including dates and left-edge flips
  it.each([NOW, NOW + 10 * 3600])(
    "retains one shared frame for all three sailings at %s",
    (now) => {
      const sailings = [90, 2700, 5400].map((offset, index) => ({
        ...sailing,
        sailingId: `fixed-${index}`,
        projectedDepartureAt: now + offset,
        scheduledDepartureAt: now + offset - 60,
        capacity: {
          ...capacity,
          anchorAt: now,
          fillAt: now + 1800,
          fillRange: { earliest: now + 1500, latest: now + 2100 },
        },
      }));
      // capture layers which must not respond to selecting another sailing
      const snapshot = (element: HTMLDivElement) => ({
        width: element.querySelector("svg")!.getAttribute("width"),
        height: element.querySelector("svg")!.getAttribute("height"),
        arrival: element.querySelector('[data-timeline-lane="arrival"]')!
          .innerHTML,
        capacity: element.querySelector('[data-timeline-lane="capacity"]')!
          .innerHTML,
        background: element.querySelector("[data-capacity-background]")!
          .innerHTML,
      });
      let original: ReturnType<typeof snapshot> | undefined;
      // each selected timeline uses the same complete trio for layout and capacity
      for (const selected of sailings) {
        const element = render({
          now,
          arrivalAt: now + 1200,
          travelUncertainty: {
            ...defaults.travelUncertainty,
            earliestArrivalAt: now + 900,
            latestArrivalAt: now + 1500,
          },
          sailing: selected,
          sailings,
        });
        expect(
          Number(element.querySelector("svg")!.getAttribute("data-domain-end"))
        ).toBe(now + 5400);
        expect(times(element)["Estimated departure"]).toBe(
          selected.projectedDepartureAt
        );
        expect(element.querySelectorAll("[data-capacity-area]")).toHaveLength(
          3
        );
        // compare the settled frame after its initial selection
        if (original) {
          expect(snapshot(element)).toEqual(original);
        }
        original = snapshot(element);
      }
    }
  );

  // parallel sailing captions need only enough horizontal spacing to separate their glyphs
  it("packs coincident sailing labels with twenty-two pixel horizontal gaps", () => {
    const element = render({
      capacity: null,
      sailing: {
        ...sailing,
        scheduledDepartureAt: sailing.projectedDepartureAt,
        operatorCutoffSeconds: 0,
      },
    });
    const labels = Array.from(
      element.querySelectorAll(
        '[data-timeline-lane="sailing"] [data-timeline-label]'
      )
    );
    expect(labels).toHaveLength(2);
    // compare adjacent anchors on one level rather than vertical staggering
    for (let index = 1; index < labels.length; index += 1) {
      expect(
        Math.abs(
          Number(labels[index].getAttribute("x")) -
            Number(labels[index - 1].getAttribute("x"))
        )
      ).toBe(22);
    }
  });

  // avoid duplicate annotations for an unchanged departure
  it("omits the Scheduled dot and label when departure is unchanged", () => {
    const element = render({
      sailing: {
        ...sailing,
        scheduledDepartureAt: sailing.projectedDepartureAt,
      },
    });
    expect(
      element.querySelector('[data-timeline-point="Scheduled departure"]')
    ).toBeNull();
    expect(
      element.querySelector('[data-timeline-label="Scheduled departure"]')
    ).toBeNull();
    expect(
      element.querySelector('[data-timeline-range="Departure shift"]')
    ).toBeNull();
    expect(
      element.querySelector('[data-timeline-point="Estimated departure"]')
    ).not.toBeNull();
    expect(
      element.querySelector('[data-timeline-label="Estimated departure"]')
    ).not.toBeNull();
  });

  // keep the original departure whenever the estimate actually changes
  it.each([-300, 300])(
    "retains the Scheduled dot and label for a %i-second departure shift",
    (offset) => {
      const scheduledDepartureAt = sailing.projectedDepartureAt + offset;
      const element = render({
        sailing: { ...sailing, scheduledDepartureAt },
      });
      expect(times(element)["Scheduled departure"]).toBe(scheduledDepartureAt);
      expect(
        element.querySelector('[data-timeline-label="Scheduled departure"]')
          ?.textContent
      ).toMatch(/^Scheduled ·/);
      expect(
        element.querySelector('[data-timeline-range="Departure shift"]')
      ).not.toBeNull();
    }
  );

  // retain useful timings while removing deadline and buffer chart clutter
  it("plots cutoff, departures and fill without a horizontal arrival timeline", () => {
    const element = render();
    expect(
      element.querySelector('figure[aria-label="Trip timing timeline"]')
    ).not.toBeNull();
    expect(times(element)).toEqual({
      "Boarding cutoff": NOW + 2520,
      "Estimated departure": NOW + 2700,
      "Scheduled departure": NOW + 2400,
      "Estimated fill time": NOW + 1800,
      "Earliest fill": NOW + 1500,
      "Latest fill": NOW + 2100,
    });
    const ranges = Array.from(
      element.querySelectorAll("[data-timeline-range]")
    );
    expect(
      ranges.map((range) => range.getAttribute("data-timeline-range"))
    ).toEqual(["Planning fill range", "Departure shift"]);
    expect(
      new Set(ranges.map((range) => range.getAttribute("class"))).size
    ).toBe(2);
    expect(
      Array.from(element.querySelectorAll("[data-lane-caption]")).map(
        (label) => label.textContent
      )
    ).toEqual(["Sailing"]);
    expect(
      element.querySelector('[data-timeline-point="WSF capacity observed"]')
    ).toBeNull();
    expect(element.querySelector("dl")).toBeNull();
    expect(element.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  // resolve caption collisions horizontally without moving timestamp markers
  it("keeps one-line 45-degree labels level while spacing them from right to left", () => {
    const element = render({
      travelUncertainty: {
        ...defaults.travelUncertainty,
        earliestArrivalAt: defaults.arrivalAt,
      },
      sailing: {
        ...sailing,
        operatorCutoffSeconds: 0,
      },
    });
    // verify collision offsets in the requested right-to-left order
    for (const lane of element.querySelectorAll("[data-timeline-lane]")) {
      const labels = Array.from(
        lane.querySelectorAll("text[data-timeline-label]")
      );
      expect(new Set(labels.map((label) => label.getAttribute("y"))).size).toBe(
        labels.length ? 1 : 0
      );
      // move only captions while retaining coincident source-time markers
      for (const label of labels) {
        const point = lane.querySelector(
          `[data-timeline-point="${label.getAttribute("data-timeline-label")}"]`
        );
        const flipped = labels[0].getAttribute("text-anchor") === "start";
        expect(label.getAttribute("text-anchor")).toBe(
          flipped ? "start" : "end"
        );
        expect(label.getAttribute("transform")).toMatch(
          flipped ? /^rotate\(45 / : /^rotate\(-45 /
        );
        expect(Number(label.getAttribute("y"))).toBeGreaterThan(
          Number(point?.getAttribute("cy"))
        );
        expect(label.querySelector("tspan")).toBeNull();
      }
      // place the rightmost caption first and make room to its left
      for (let index = 1; index < labels.length; index += 1) {
        const direction =
          labels[0].getAttribute("text-anchor") === "start" ? 1 : -1;
        expect(
          direction * Number(labels[index].getAttribute("x"))
        ).toBeGreaterThan(
          direction * Number(labels[index - 1].getAttribute("x"))
        );
      }
    }
    expect(element.querySelector("[data-label-connector]")).toBeNull();
    expect(
      element.querySelectorAll(
        "path:not([data-capacity-area]):not([data-capacity-envelope]):not([data-capacity-curve])"
      )
    ).toHaveLength(0);
    const departure = element.querySelector(
      '[data-timeline-point="Estimated departure"]'
    )!;
    const cutoff = element.querySelector(
      '[data-timeline-point="Boarding cutoff"]'
    )!;
    expect(departure.getAttribute("cx")).toBe(cutoff.getAttribute("cx"));
    expect(
      element
        .querySelector('[data-timeline-label="Estimated departure"]')!
        .getAttribute("x")
    ).not.toBe(
      element
        .querySelector('[data-timeline-label="Boarding cutoff"]')!
        .getAttribute("x")
    );
    expect(element.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  // match each lane heading, line, point and caption to one distinct lane color
  it("right-aligns the blue Sailing heading above its latest marker", () => {
    const element = render();
    // verify both independent timeline identities and right-hand heading anchors
    for (const [id, color] of [["sailing", "text-sky-700"]]) {
      const lane = element.querySelector(`[data-timeline-lane="${id}"]`)!;
      const heading = lane.querySelector("[data-lane-caption]")!;
      const points = Array.from(lane.querySelectorAll("[data-timeline-point]"));
      expect(lane.getAttribute("class")).toContain(color);
      expect(heading.getAttribute("text-anchor")).toBe("end");
      expect(Number(heading.getAttribute("x"))).toBe(
        Math.max(...points.map((point) => Number(point.getAttribute("cx"))))
      );
      expect(Number(heading.getAttribute("y"))).toBeLessThan(
        Number(points[0].getAttribute("cy"))
      );
      expect(
        Array.from(lane.querySelectorAll("g[class]")).every((group) =>
          group.getAttribute("class")?.includes(color)
        )
      ).toBe(true);
    }
    expect(
      element.querySelector('[data-timeline-label="Estimated departure"]')
        ?.textContent
    ).toMatch(/^Departure ·/);
    expect(
      element.querySelector(
        '[data-timeline-point="Arrival deadline with buffer"]'
      )
    ).toBeNull();
    expect(
      element.querySelector('[data-timeline-point="Arrival + buffer"]')
    ).toBeNull();
    expect(
      element.querySelector('[data-timeline-range="Boarding cutoff"]')
    ).toBeNull();
    expect(
      element.querySelector('[data-timeline-range="Safety buffer"]')
    ).toBeNull();
  });

  // an arrival beyond Later remains explicitly off-window rather than extending the axis
  it("clamps a late ETA marker to the boundary while retaining its real time", () => {
    const element = render({ arrivalAt: NOW + 4000 });
    const marker = element.querySelector("[data-arrival-marker]")!;
    expect(marker.getAttribute("x1")).toBe(
      element.querySelector("[data-time-axis]")!.getAttribute("x2")
    );
    expect(marker.getAttribute("data-clipped")).toBe("true");
    expect(Number(marker.getAttribute("data-time"))).toBe(NOW + 4000);
    expect(element.querySelector("[data-arrival-caption]")!.textContent).toBe(
      "ETA →"
    );
    expect(
      Number(element.querySelector("svg")!.getAttribute("data-domain-end"))
    ).toBe(sailing.projectedDepartureAt);
  });

  // retain readable lane identities for off-window timestamps
  it("keeps right-aligned headings readable when a lane's latest point is clipped left", () => {
    const element = render({
      arrivalAt: NOW - 300,
      travelUncertainty: {
        ...defaults.travelUncertainty,
        earliestArrivalAt: NOW - 600,
        latestArrivalAt: NOW - 120,
      },
      sailing: {
        ...sailing,
        projectedDepartureAt: NOW - 30,
        scheduledDepartureAt: NOW - 60,
      },
      capacity: null,
    });
    // constrain only the clipped heading, not the true timestamps or boundary markers
    for (const lane of element.querySelectorAll(
      '[data-timeline-lane="sailing"]'
    )) {
      const heading = lane.querySelector("[data-lane-caption]")!;
      expect(heading.getAttribute("text-anchor")).toBe("end");
      expect(Number(heading.getAttribute("x"))).toBeGreaterThan(4);
      expect(
        Array.from(lane.querySelectorAll("[data-timeline-point]")).every(
          (point) =>
            point.getAttribute("cx") === "4" &&
            point.getAttribute("data-clipped") === "true"
        )
      ).toBe(true);
    }
  });

  // mark exhaustion using the supplied live model rather than forecast probability
  it("labels Capacity, darkens the area after estimated fill and dots conservative fill", () => {
    const element = render();
    const svg = element.querySelector("svg")!;
    const label = element.querySelector("[data-capacity-caption]")!;
    expect(label.textContent).toBe("Capacity");
    expect(label.getAttribute("text-anchor")).toBe("end");
    expect(Number(label.getAttribute("x"))).toBeGreaterThan(
      Number(svg.getAttribute("width")) - 20
    );
    expect(Number(label.getAttribute("y"))).toBeLessThan(
      Number(svg.getAttribute("data-graph-bottom"))
    );
    const region = element.querySelector("[data-full-capacity-region]")!;
    expect(Number(region.getAttribute("data-time"))).toBe(capacity.fillAt);
    expect(region.getAttribute("x")).toBe(
      element
        .querySelector('[data-timeline-point="Estimated fill time"]')
        ?.getAttribute("cx")
    );
    expect(Number(region.getAttribute("fill-opacity"))).toBeGreaterThan(
      Number(
        element
          .querySelector("[data-capacity-area]")!
          .getAttribute("fill-opacity")
      )
    );
    const conservative = element.querySelector("[data-conservative-fill]")!;
    expect(Number(conservative.getAttribute("data-time"))).toBe(
      capacity.fillRange?.earliest
    );
    expect(conservative.getAttribute("x1")).toBe(
      conservative.getAttribute("x2")
    );
    expect(conservative.getAttribute("x1")).toBe(
      element
        .querySelector('[data-timeline-point="Earliest fill"]')
        ?.getAttribute("cx")
    );
    expect(conservative.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(Number(conservative.getAttribute("y1"))).toBe(
      Number(svg.getAttribute("data-graph-top"))
    );
    expect(Number(conservative.getAttribute("y2"))).toBe(
      Number(svg.getAttribute("data-graph-bottom"))
    );
    expect(
      element.querySelector("[data-capacity-envelope]")?.getAttribute("d")
    ).toContain(
      `L ${conservative.getAttribute("x1")} ${svg.getAttribute("data-graph-top")}`
    );
  });

  // do not suggest a full-before-departure boundary without its real timing and model
  it.each([null, NOW + 2700, NOW + 3000])(
    "omits full shading when estimated fill is %s",
    (fillAt) => {
      const element = render({ capacity: { ...capacity, fillAt } });
      expect(element.querySelector("[data-full-capacity-region]")).toBeNull();
    }
  );

  // leave missing conservative bounds unknown rather than manufacturing a line
  it("omits full annotations without projection or known conservative timing", () => {
    const noProjection = render({
      capacity: { ...capacity, projection: undefined },
    });
    expect(
      noProjection.querySelector("[data-full-capacity-region]")
    ).toBeNull();
    expect(noProjection.querySelector("[data-conservative-fill]")).toBeNull();
    expect(noProjection.querySelector("[data-capacity-caption]")).toBeNull();
    const noEarliest = render({
      capacity: {
        ...capacity,
        fillRange: { earliest: null, latest: NOW + 2100 },
      },
    });
    expect(noEarliest.querySelector("[data-conservative-fill]")).toBeNull();
    expect(
      noEarliest.querySelector("[data-full-capacity-region]")
    ).not.toBeNull();
  });

  // use the whole chart width instead of reserving an annotation gutter
  it("spans the time axis across the graph with clock labels underneath", () => {
    const element = render();
    const svg = element.querySelector("svg")!;
    expect(svg.getAttribute("fill")).toBe("currentColor");
    const axis = element.querySelector("[data-time-axis]")!;
    const width = Number(svg.getAttribute("width"));
    expect(axis).not.toBeNull();
    expect(Number(axis.getAttribute("x1"))).toBeLessThanOrEqual(8);
    expect(Number(axis.getAttribute("x2"))).toBeGreaterThanOrEqual(width - 8);
    const top = Number(svg.getAttribute("data-graph-top"));
    const bottom = Number(svg.getAttribute("data-graph-bottom"));
    const labels = Array.from(element.querySelectorAll("[data-axis-label]"));
    expect(labels.length).toBeGreaterThanOrEqual(2);
    // keep percent captions inside and clock captions below the plotted rectangle
    for (const label of labels) {
      expect(Number(label.getAttribute("x"))).toBeGreaterThan(0);
      expect(Number(label.getAttribute("x"))).toBeLessThan(width);
      expect(Number(label.getAttribute("y"))).toBeGreaterThan(top);
      // the clock baseline belongs beneath the horizontal axis
      if (label.getAttribute("data-axis-label") === "time") {
        expect(Number(label.getAttribute("y"))).toBeGreaterThan(bottom);
      } else {
        expect(Number(label.getAttribute("y"))).toBeLessThan(bottom);
      }
    }
  });

  // capacity and comparison markers occupy the same inferred zero-to-full graph
  it("paints capacity behind Sailing and both full-height vertical markers", () => {
    const element = render();
    const svg = element.querySelector("svg")!;
    const top = Number(svg.getAttribute("data-graph-top"));
    const bottom = Number(svg.getAttribute("data-graph-bottom"));
    expect(bottom - top).toBeGreaterThanOrEqual(180);
    expect(
      Number(
        element
          .querySelector('[data-timeline-point="Estimated departure"]')!
          .getAttribute("cy")
      )
    ).toBe(top);
    const background = element.querySelector("[data-capacity-background]")!;
    // curves paint beneath both independent comparison markers
    for (const selector of [
      '[data-timeline-lane="sailing"]',
      "[data-arrival-marker]",
      "[data-cutoff-marker]",
    ]) {
      expect(
        background.compareDocumentPosition(element.querySelector(selector)!) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).not.toBe(0);
    }
    expect(
      Number(
        element.querySelector('[data-capacity-grid="100"]')!.getAttribute("y1")
      )
    ).toBe(top);
    expect(
      Number(
        element.querySelector('[data-capacity-grid="0"]')!.getAttribute("y1")
      )
    ).toBe(bottom);
    expect(
      Number(element.querySelector("[data-time-axis]")!.getAttribute("y1"))
    ).toBe(bottom);
    expect(
      Number(element.querySelector("[data-arrival-caption]")!.getAttribute("y"))
    ).toBe((top + bottom) / 2);
  });

  // the requested x-domain excludes buffers and capacity observation timestamps
  it.each([NOW + 1500, NOW + 4000])(
    "ends at the last displayed departure even with latest arrival %s",
    (latestArrivalAt) => {
      const element = render({
        travelUncertainty: { ...defaults.travelUncertainty, latestArrivalAt },
      });
      const svg = element.querySelector("svg")!;
      expect(Number(svg.getAttribute("data-domain-start"))).toBe(NOW);
      expect(Number(svg.getAttribute("data-domain-end"))).toBe(
        sailing.projectedDepartureAt
      );
    }
  );

  // boarding clears the modeled queue when the preceding sailing still has room
  it("resets next-sailing capacity to zero after a non-full departure", () => {
    const notFull = {
      ...capacity,
      fillAt: null,
      fillRange: null,
      projection: {
        totalSpaces: 100,
        rate: { minimum: 0.1, mostLikely: 0.2, maximum: 0.3 },
      },
    };
    const element = render({
      capacity: notFull,
      sailing: { ...sailing, capacity: notFull },
      subsequentSailing: { ...sailing, projectedDepartureAt: NOW + 5400 },
    });
    const next = element.querySelector('[data-capacity-index="1"]')!;
    const samples = JSON.parse(
      next.querySelector("[data-capacity-curve]")!.getAttribute("data-samples")!
    );
    expect(samples[0]).toEqual({
      at: sailing.projectedDepartureAt,
      percent: 0,
    });
    expect(samples.at(-1).percent).toBeCloseTo(45);
    expect(next.querySelector("[data-full-capacity-region]")).toBeNull();
    expect(element.querySelector("figcaption")).toBeNull();
    expect(
      Array.from(element.querySelectorAll("p")).map((p) => p.textContent)
    ).not.toContain("Includes space allocated away from drive-up.");
  });

  // direct zero says full but cannot measure how many vehicles were left behind
  it("uses the next own live model without inventing carryover from a direct-full report", () => {
    const full = {
      ...capacity,
      state: "already-full" as const,
      observedSpacesAtAnchor: 0,
      projection: {
        totalSpaces: 100,
        rate: { minimum: 0, mostLikely: 0, maximum: 0 },
      },
    };
    const element = render({
      capacity: full,
      sailing: { ...sailing, capacity: full },
      subsequentSailing: { ...sailing, projectedDepartureAt: NOW + 5400 },
    });
    expect(
      element.querySelector('[data-capacity-index="1"] [data-capacity-area]')
    ).not.toBeNull();
    expect(
      element
        .querySelector('[data-capacity-index="1"]')!
        .getAttribute("data-model-basis")
    ).toBe("live");
    expect(element.querySelector("desc")?.textContent).toContain(
      "carryover unknown"
    );
  });

  // a subsequent direct-zero report has no demand rate to extrapolate after reset
  it("shows a subsequent direct-full report as its own flat hundred-percent area", () => {
    const full = {
      ...capacity,
      state: "already-full" as const,
      observedSpacesAtAnchor: 0,
      projection: {
        totalSpaces: 100,
        rate: { minimum: 0, mostLikely: 0, maximum: 0 },
      },
    };
    const element = render({
      subsequentSailing: {
        ...sailing,
        capacity: full,
        projectedDepartureAt: NOW + 5400,
      },
    });
    expect(element.querySelector('[data-capacity-index="1"]')).not.toBeNull();
    const samples = JSON.parse(
      element
        .querySelector('[data-capacity-index="1"] [data-capacity-curve]')!
        .getAttribute("data-samples")!
    );
    expect(
      samples.every((sample: { percent: number }) => sample.percent === 100)
    ).toBe(true);
    expect(
      element
        .querySelector('[data-capacity-index="1"]')!
        .getAttribute("data-model-basis")
    ).toBe("live");
    expect(element.querySelector("desc")?.textContent).toContain(
      "carryover unknown"
    );
  });

  // each sailing owns its live anchor rather than inheriting the preceding inventory
  it("shades the subsequent sailing independently after selected departure", () => {
    const subsequentSailing = {
      ...sailing,
      vesselName: "Next vessel",
      projectedDepartureAt: NOW + 5400,
      scheduledDepartureAt: NOW + 5400,
      capacity: {
        ...capacity,
        observedSpacesAtAnchor: 90,
        fillAt: null,
        fillRange: null,
        projection: {
          totalSpaces: 100,
          rate: { minimum: 0.25, mostLikely: 0.5, maximum: 0.75 },
        },
      },
    };
    const element = render({ subsequentSailing });
    const svg = element.querySelector("svg")!;
    expect(Number(svg.getAttribute("data-domain-end"))).toBe(NOW + 5400);
    const selected = element.querySelector('[data-capacity-index="0"]')!;
    const next = element.querySelector('[data-capacity-index="1"]')!;
    expect(next.querySelector("[data-capacity-area]")).not.toBeNull();
    const samples = JSON.parse(
      next.querySelector("[data-capacity-curve]")!.getAttribute("data-samples")!
    );
    expect(samples[0].at).toBe(sailing.projectedDepartureAt);
    expect(samples[0].percent).toBeCloseTo(15);
    expect(samples.at(-1).at).toBe(NOW + 5400);
    expect(samples.at(-1).percent).toBeCloseTo(37.5);
    const departure = element.querySelector(
      '[data-timeline-point="Estimated departure"]'
    )!;
    const full = selected.querySelector("[data-full-capacity-region]")!;
    expect(
      Number(full.getAttribute("x")) + Number(full.getAttribute("width"))
    ).toBeCloseTo(Number(departure.getAttribute("cx")));
    expect(next.querySelector("[data-full-capacity-region]")).toBeNull();
    expect(svg.querySelector("desc")?.textContent).toContain("Next vessel");
  });

  // exhaustion annotations also belong exclusively to the subsequent inventory
  it("bounds the next sailing's own full shading and conservative line to its interval", () => {
    const element = render({
      subsequentSailing: {
        ...sailing,
        projectedDepartureAt: NOW + 5400,
        capacity: {
          ...capacity,
          observedSpacesAtAnchor: 90,
          fillAt: NOW + 4500,
          fillRange: { earliest: NOW + 3600, latest: NOW + 5400 },
          projection: {
            totalSpaces: 100,
            rate: { minimum: 2, mostLikely: 3, maximum: 3.5 },
          },
        },
      },
    });
    const next = element.querySelector('[data-capacity-index="1"]')!;
    const full = next.querySelector("[data-full-capacity-region]")!;
    const conservative = next.querySelector("[data-conservative-fill]")!;
    expect(Number(full.getAttribute("data-time"))).toBe(NOW + 4400);
    expect(Number(conservative.getAttribute("data-time"))).toBeCloseTo(
      NOW + 2700 + (76 / 3.5) * 60
    );
    expect(
      Number(full.getAttribute("x")) + Number(full.getAttribute("width"))
    ).toBe(
      Number(element.querySelector("[data-time-axis]")!.getAttribute("x2"))
    );
    expect(
      next.querySelector("[data-capacity-envelope]")!.getAttribute("d")
    ).toContain(
      `L ${conservative.getAttribute("x1")} ${element.querySelector("svg")!.getAttribute("data-graph-top")}`
    );
  });

  // unavailable neighboring inventory is not a full-probability occupancy curve
  it("keeps the subsequent sailing unknown without its own live projection", () => {
    const element = render({
      subsequentSailing: {
        ...sailing,
        capacity: null,
        projectedDepartureAt: NOW + 5400,
      },
    });
    expect(element.querySelectorAll("[data-capacity-area]")).toHaveLength(1);
    expect(element.textContent).toContain("Capacity or carryover unknown");
  });

  // simultaneous or already elapsed sailings cannot extend the chart as successors
  it.each([NOW - 1, sailing.projectedDepartureAt])(
    "omits an invalid successor departing at %s",
    (projectedDepartureAt) => {
      const element = render({
        subsequentSailing: { ...sailing, projectedDepartureAt },
      });
      expect(element.querySelector('[data-capacity-index="1"]')).toBeNull();
      expect(
        Number(element.querySelector("svg")!.getAttribute("data-domain-end"))
      ).toBe(sailing.projectedDepartureAt);
    }
  );

  // a departed selection cannot suppress a following sailing's independent model
  it("starts the next area at now when the selected departure has elapsed", () => {
    const element = render({
      sailing: { ...sailing, projectedDepartureAt: NOW - 1 },
      capacity: { ...capacity, anchorAt: NOW - 1800 },
      subsequentSailing: { ...sailing, projectedDepartureAt: NOW + 2700 },
    });
    const curve = element.querySelector(
      '[data-capacity-index="1"] [data-capacity-curve]'
    )!;
    expect(JSON.parse(curve.getAttribute("data-samples")!)[0].at).toBe(NOW);
    expect(
      element.querySelector('[data-capacity-index="0"] [data-capacity-area]')
    ).toBeNull();
  });

  // left-edge arrival markers remain vertically captioned without a horizontal label bank
  it("keeps an early ETA marker exact and its vertical label inside the graph", () => {
    const element = render({ arrivalAt: NOW + 10 });
    const marker = element.querySelector("[data-arrival-marker]")!;
    const label = element.querySelector("[data-arrival-caption]")!;
    expect(Number(marker.getAttribute("data-time"))).toBe(NOW + 10);
    expect(Number(label.getAttribute("x"))).toBeGreaterThan(
      Number(marker.getAttribute("x1"))
    );
    expect(label.getAttribute("transform")).toMatch(/^rotate\(-90 /);
    expect(
      element.querySelectorAll(
        '[data-timeline-lane="arrival"] [data-timeline-label]'
      )
    ).toHaveLength(0);
  });

  // retain the original right-aligned direction when both banks fit their natural anchors
  it("does not flip timelines whose earliest captions fit at their marker positions", () => {
    const element = render({
      arrivalAt: NOW + 4500,
      sailing: {
        ...sailing,
        projectedDepartureAt: NOW + 7200,
        scheduledDepartureAt: NOW + 7200,
      },
      capacity: null,
      travelUncertainty: {
        ...defaults.travelUncertainty,
        earliestArrivalAt: NOW + 4000,
        latestArrivalAt: NOW + 5000,
      },
    });
    // each timeline retains counterclockwise rotation and right-edge alignment
    for (const label of element.querySelectorAll(
      '[data-timeline-lane="sailing"] [data-timeline-label]'
    )) {
      expect(label.getAttribute("text-anchor")).toBe("end");
      expect(label.getAttribute("transform")).toMatch(/^rotate\(-45 /);
    }
  });

  // both timelines may need independent clockwise caption banks
  it("flips sailing captions when all sailing timestamps are near the left edge", () => {
    const element = render({
      subsequentSailing: {
        ...sailing,
        projectedDepartureAt: NOW + 8000,
        capacity: null,
      },
      travelUncertainty: {
        ...defaults.travelUncertainty,
        latestArrivalAt: NOW + 8000,
      },
      sailing: {
        ...sailing,
        projectedDepartureAt: NOW + 90,
        scheduledDepartureAt: NOW + 60,
      },
      capacity: null,
    });
    const labels = Array.from(
      element.querySelectorAll(
        '[data-timeline-lane="sailing"] [data-timeline-label]'
      )
    );
    expect(
      labels.every(
        (label) =>
          label.getAttribute("text-anchor") === "start" &&
          /^rotate\(45 /.test(label.getAttribute("transform")!)
      )
    ).toBe(true);
    expect(labels[0].getAttribute("data-timeline-label")).toBe(
      "Boarding cutoff"
    );
  });

  // percentage fullness follows the live model and is bounded at both axes
  it("shades a 0–100 percent used-capacity projection through departure", () => {
    const element = render();
    expect(element.querySelector("[data-capacity-area]")).not.toBeNull();
    expect(element.querySelector("[data-capacity-envelope]")).not.toBeNull();
    expect(element.textContent).toContain("0%");
    expect(element.textContent).toContain("100%");
    const samples = JSON.parse(
      element
        .querySelector("[data-capacity-curve]")!
        .getAttribute("data-samples")!
    ) as { at: number; percent: number }[];
    expect(samples[0]).toEqual({ at: NOW, percent: 70 });
    expect(
      samples.every((sample) => sample.percent >= 0 && sample.percent <= 100)
    ).toBe(true);
    expect(samples.at(-1)?.at).toBe(sailing.projectedDepartureAt);
    expect(samples.at(-1)?.percent).toBe(100);
    expect(samples.find((sample) => sample.percent === 100)?.at).toBe(
      capacity.fillAt
    );
  });

  // legacy or forecast-only data cannot establish percent full over time
  it("leaves the capacity graph unknown without a real denominator and rate", () => {
    const element = render({
      capacity: { ...capacity, projection: undefined },
    });
    expect(element.querySelector("[data-capacity-area]")).toBeNull();
    expect(element.textContent).toContain("Capacity projection unavailable");
    // a supplied fill timestamp does not require a percent-capacity denominator
    expect(times(element)["Estimated fill time"]).toBe(capacity.fillAt);
    expect(element.querySelector("[data-full-capacity-region]")).toBeNull();
    expect(element.querySelector("[data-conservative-fill]")).toBeNull();
  });

  // forecast-only and departed details must not fabricate live fill data
  it("omits live capacity markers and ranges when no usable capacity is supplied", () => {
    const element = render({ capacity: null, travelUncertainty: null });
    expect(element.querySelector("[data-capacity-area]")).toBeNull();
    expect(
      element.querySelectorAll(
        '[data-timeline-lane="capacity"] [data-timeline-point]'
      )
    ).toHaveLength(0);
    expect(
      element.querySelector('[data-timeline-point="Earliest arrival"]')
    ).toBeNull();
    expect(
      element.querySelector('[data-timeline-range="Planning arrival range"]')
    ).toBeNull();
    expect(
      element.querySelectorAll(
        '[data-timeline-lane="capacity"] [data-timeline-point]'
      )
    ).toHaveLength(0);
    expect(element.textContent).not.toContain("WSF capacity observed");
  });

  // a one-sided range remains one-sided rather than inventing an endpoint
  it.each(["earliest", "latest"] as const)(
    "identifies an unknown %s fill bound",
    (missing) => {
      const element = render({
        capacity: {
          ...capacity,
          fillRange: { ...capacity.fillRange!, [missing]: null },
        },
      });
      expect(
        element.querySelector('[data-timeline-range="Planning fill range"]')
      ).toBeNull();
      expect(
        element.querySelector(
          `[data-timeline-point="${missing === "earliest" ? "Earliest" : "Latest"} fill"]`
        )
      ).toBeNull();
      expect(element.textContent).toContain(
        `${missing[0].toUpperCase()}${missing.slice(1)} fill time unknown`
      );
      expect(element.innerHTML).not.toMatch(/NaN|Infinity/);
    }
  );

  // preserve real chronological spacing across Pacific midnight
  it("adds calendar dates when the timeline crosses midnight", () => {
    const midnight = DateTime.fromISO("2026-10-06T00:00:00", {
      zone: "America/Los_Angeles",
    }).toSeconds();
    const element = render({
      now: midnight - 1200,
      arrivalAt: midnight - 600,
      travelUncertainty: null,
      capacity: null,
      sailing: {
        ...sailing,
        projectedDepartureAt: midnight + 600,
        scheduledDepartureAt: midnight + 600,
      },
    });
    expect(element.textContent).toContain("Oct 5");
    expect(element.textContent).toContain("Oct 6");
    expect(element.textContent).toContain("11:50 PM");
    expect(element.textContent).toContain("12:10 AM");
    const arrival = Number(
      element.querySelector("[data-arrival-marker]")?.getAttribute("x1")
    );
    const departure = Number(
      element
        .querySelector('[data-timeline-point="Estimated departure"]')
        ?.getAttribute("cx")
    );
    expect(arrival).toBeLessThan(departure);
  });
});
