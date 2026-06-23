import { describe, expect, it } from "vitest";

import { calculateWeatherAdjustmentRows } from "../../server/lib/weather/calculateCapacityAdjustments";

const createSample = (input = {}) => ({
  arrivalId: "2",
  baselineDriveUpCapacity: 50,
  baselineReservableCapacity: 10,
  departureId: "1",
  driveUpCapacity: 40,
  reservableCapacity: 8,
  weather: {
    cloudCoverPercent: 90,
    precipitationMm: 3,
    temperatureC: 5,
    windSpeedKmh: 40,
  },
  ...input,
});

describe("weather adjustment calculation", () => {
  // strong signal behavior
  it("enables rows when sample size and effect are strong enough", () => {
    const rows = calculateWeatherAdjustmentRows(
      Array.from({ length: 8 }, () => createSample())
    );
    const precipitationDriveUp = rows.find(
      (row) =>
        row.capacityType === "driveUp" &&
        row.weatherBucket === "precipitation:moderate-heavy"
    );

    expect(precipitationDriveUp).toMatchObject({
      adjustmentSpaces: -10,
      isEnabled: true,
      maxAdjustmentSpaces: 10,
      sampleSize: 8,
    });
  });

  // weak signal behavior
  it("disables under-sampled rows", () => {
    const rows = calculateWeatherAdjustmentRows([createSample()]);

    expect(rows.every((row) => !row.isEnabled)).toBe(true);
  });

  // small effect behavior
  it("disables small effects even with enough samples", () => {
    const rows = calculateWeatherAdjustmentRows(
      Array.from({ length: 8 }, () =>
        createSample({ driveUpCapacity: 49, reservableCapacity: 10 })
      )
    );
    const precipitationDriveUp = rows.find(
      (row) =>
        row.capacityType === "driveUp" &&
        row.weatherBucket === "precipitation:moderate-heavy"
    );

    expect(precipitationDriveUp).toMatchObject({
      adjustmentSpaces: -1,
      isEnabled: false,
    });
  });
});
