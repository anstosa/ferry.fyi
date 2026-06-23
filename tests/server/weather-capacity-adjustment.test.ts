import { describe, expect, it } from "vitest";

import {
  applyWeatherAdjustment,
  getWeatherBuckets,
} from "../../server/lib/weather/capacityAdjustment";

// create adjustment rule
const createRule = (input = {}) => ({
  adjustmentSpaces: 0,
  capacityType: "driveUp" as const,
  isEnabled: true,
  maxAdjustmentSpaces: 20,
  sampleSize: 20,
  weatherBucket: "precipitation:none",
  ...input,
});

describe("weather capacity adjustment", () => {
  // no-op behavior
  it("leaves capacity unchanged without rules", () => {
    const adjusted = applyWeatherAdjustment({
      capacity: { driveUpCapacity: 30, reservableCapacity: 10 },
      liveCapacity: { driveUpCapacity: 80, reservableCapacity: 20 },
      rules: [],
    });

    expect(adjusted).toEqual({ driveUpCapacity: 30, reservableCapacity: 10 });
  });

  // cap behavior
  it("applies enabled adjustments within signal and global caps", () => {
    const adjusted = applyWeatherAdjustment({
      capacity: { driveUpCapacity: 30, reservableCapacity: 10 },
      liveCapacity: { driveUpCapacity: 80, reservableCapacity: 20 },
      rules: [createRule({ adjustmentSpaces: -50, maxAdjustmentSpaces: 12 })],
    });

    expect(adjusted.driveUpCapacity).toBe(18);
  });

  // live-bound behavior
  it("does not increase estimates beyond live capacity", () => {
    const adjusted = applyWeatherAdjustment({
      capacity: { driveUpCapacity: 75, reservableCapacity: 18 },
      liveCapacity: { driveUpCapacity: 80, reservableCapacity: 20 },
      rules: [
        createRule({ adjustmentSpaces: 20 }),
        createRule({
          adjustmentSpaces: 10,
          capacityType: "reservable",
          weatherBucket: "wind:breezy",
        }),
      ],
    });

    expect(adjusted).toEqual({ driveUpCapacity: 80, reservableCapacity: 20 });
  });

  // weak signal behavior
  it("ignores disabled and under-sampled adjustments", () => {
    const adjusted = applyWeatherAdjustment({
      capacity: { driveUpCapacity: 30, reservableCapacity: 10 },
      liveCapacity: { driveUpCapacity: 80, reservableCapacity: 20 },
      rules: [
        createRule({ adjustmentSpaces: -10, isEnabled: false }),
        createRule({ adjustmentSpaces: -10, sampleSize: 3 }),
      ],
    });

    expect(adjusted).toEqual({ driveUpCapacity: 30, reservableCapacity: 10 });
  });

  // bucket behavior
  it("maps weather conditions to interpretable buckets", () => {
    expect(
      getWeatherBuckets({
        cloudCoverPercent: 90,
        precipitationMm: 3,
        temperatureC: 5,
        windSpeedKmh: 40,
      })
    ).toEqual([
      "precipitation:moderate-heavy",
      "wind:windy",
      "cloud:overcast",
      "temperature:cold",
    ]);
  });
});
