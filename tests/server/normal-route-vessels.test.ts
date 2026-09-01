import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/logger", () => ({
  default: { info: vi.fn() },
}));

vi.mock("~/models/NormalRouteVessel", () => ({
  NormalRouteVessel: {
    destroy: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock("~/models/Route", () => ({
  Route: { getAll: vi.fn(() => ({})) },
}));

vi.mock("~/lib/wsf/api", () => ({
  wsfRequest: vi.fn(),
}));

const { calculateNormalRouteVesselAssignments } = await import(
  "../../server/lib/wsf/updateNormalRouteVessels"
);

const sampleDates = Array.from({ length: 28 }, (_, index) => {
  // stable test dates
  return `2026-07-${String(index + 1).padStart(2, "0")}`;
});

describe("normal route vessel inference", () => {
  // threshold behavior
  it("marks vessels normal when they meet the sampled-day threshold", () => {
    const observations = sampleDates.slice(0, 21).map((date) => {
      // build daily sailing
      return {
        date,
        position: 1,
        routeId: "6",
        vesselId: "25",
        vesselName: "Puyallup",
      };
    });

    const [assignment] = calculateNormalRouteVesselAssignments(
      "6",
      observations,
      sampleDates,
      1782300000
    );

    expect(assignment).toMatchObject({
      daysObserved: 21,
      isNormal: true,
      positions: [1],
      routeId: "6",
      sampleDays: 28,
      vesselId: "25",
      vesselName: "Puyallup",
    });
  });

  // temporary behavior
  it("keeps short-appearance vessels as observed but not normal", () => {
    const observations = sampleDates.slice(0, 4).map((date) => {
      // build temporary sailing
      return {
        date,
        position: 4,
        routeId: "9",
        vesselId: "33",
        vesselName: "Tillikum",
      };
    });

    const [assignment] = calculateNormalRouteVesselAssignments(
      "9",
      observations,
      sampleDates,
      1782300000
    );

    expect(assignment).toMatchObject({
      daysObserved: 4,
      isNormal: false,
      positions: [4],
      routeId: "9",
      sampleDays: 28,
      vesselId: "33",
      vesselName: "Tillikum",
    });
    expect(assignment.inferenceNotes).toContain("threshold is 21 days");
  });

  // sailing aggregation
  it("counts multiple sailings on the same day once for days observed", () => {
    const observations = [
      {
        date: sampleDates[0],
        position: 1,
        routeId: "5",
        vesselId: "32",
        vesselName: "Tacoma",
      },
      {
        date: sampleDates[0],
        position: 2,
        routeId: "5",
        vesselId: "32",
        vesselName: "Tacoma",
      },
    ];

    const [assignment] = calculateNormalRouteVesselAssignments(
      "5",
      observations,
      sampleDates,
      1782300000
    );

    expect(assignment.daysObserved).toBe(1);
    expect(assignment.sailingsObserved).toBe(2);
    expect(assignment.positions).toEqual([1, 2]);
  });
});
