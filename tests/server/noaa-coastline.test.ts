import { describe, expect, it } from "vitest";

import {
  type CoastlineSnapshot,
  evaluateOffshoreEligibility,
  MIN_OFFSHORE_DISTANCE_METERS,
} from "../../server/lib/noaaCoastline";

const snapshot: CoastlineSnapshot = {
  features: [
    {
      geometry: {
        coordinates: [
          [
            [0, 0],
            [0.02, 0],
            [0.02, 0.02],
            [0, 0.02],
            [0, 0],
          ],
        ],
        type: "Polygon",
      },
      properties: { snapshotLayer: "coverage" },
    },
    {
      geometry: {
        coordinates: [
          [0.001, 0],
          [0.001, 0.02],
        ],
        type: "LineString",
      },
      properties: { snapshotLayer: "coastline" },
    },
  ],
};

describe("NOAA ENC coastline eligibility", () => {
  it("requires 500 feet of coastline clearance after GPS accuracy", () => {
    expect(MIN_OFFSHORE_DISTANCE_METERS).toBe(152.4);
    expect(
      evaluateOffshoreEligibility(
        { latitude: 0.01, longitude: 0.004 },
        100,
        snapshot
      )
    ).toMatchObject({ eligible: true });
    expect(
      evaluateOffshoreEligibility(
        { latitude: 0.01, longitude: 0.003 },
        100,
        snapshot
      )
    ).toEqual({ eligible: false, reason: "TOO_CLOSE_TO_SHORE" });
  });

  it("fails closed outside known ENC coverage or without coastline data", () => {
    expect(
      evaluateOffshoreEligibility(
        { latitude: 0.03, longitude: 0.03 },
        1,
        snapshot
      )
    ).toEqual({ eligible: false, reason: "COASTLINE_COVERAGE_UNKNOWN" });
    expect(
      evaluateOffshoreEligibility({ latitude: 0.01, longitude: 0.004 }, 1, {
        features: [snapshot.features[0]],
      })
    ).toEqual({ eligible: false, reason: "TOO_CLOSE_TO_SHORE" });
  });
});
