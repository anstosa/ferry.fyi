import { describe, expect, it } from "vitest";

import {
  getCapacityUsage,
  getCapacityDisplayPercent,
  getVesselVehicleCapacity,
  isCapacityFull,
} from "../../client/views/Schedule/capacityFullness";

// capacity full contract
describe("isCapacityFull", () => {
  // exact full capacity
  it("counts zero spaces as full", () => {
    expect(isCapacityFull({ percentFull: 60, spacesLeft: 0 })).toBe(true);
  });

  // threshold case
  it("counts capacity over ninety percent as full", () => {
    expect(isCapacityFull({ percentFull: 91, spacesLeft: 9 })).toBe(true);
  });

  // strict threshold case
  it("does not count exactly ninety percent as full", () => {
    expect(isCapacityFull({ percentFull: 90, spacesLeft: 10 })).toBe(false);
  });

  // not full case
  it("does not count lower capacity with spaces left as full", () => {
    expect(isCapacityFull({ percentFull: 80, spacesLeft: 20 })).toBe(false);
  });
  // full display width
  it("shows full classifications at one hundred percent width", () => {
    expect(
      getCapacityDisplayPercent({ isFull: true, percentFull: 91 })
    ).toBe(100);
  });

  // normal display width
  it("preserves non-full display width", () => {
    expect(
      getCapacityDisplayPercent({ isFull: false, percentFull: 80 })
    ).toBe(80);
  });

  // shared capacity calculation
  it("normalizes spaces and fullness across schedule surfaces", () => {
    expect(
      getCapacityUsage({
        driveUpCapacity: 3,
        reservableCapacity: 2,
        totalCapacity: 100,
      })
    ).toEqual({ percentFull: 95, spacesLeft: 5 });
    expect(
      getCapacityUsage({
        driveUpCapacity: 120,
        reservableCapacity: 0,
        totalCapacity: 100,
      })
    ).toEqual({ percentFull: 0, spacesLeft: 120 });
    expect(
      getCapacityUsage({
        driveUpCapacity: 3,
        reservableCapacity: 0,
        totalCapacity: 0,
      })
    ).toEqual({ percentFull: null, spacesLeft: 3 });
  });

  // vessel capacity calculation
  it("derives non-negative usable vehicle capacity", () => {
    expect(
      getVesselVehicleCapacity({
        tallVehicleCapacity: 20,
        vehicleCapacity: 140,
      })
    ).toBe(120);
    expect(
      getVesselVehicleCapacity({
        tallVehicleCapacity: 20,
        vehicleCapacity: 10,
      })
    ).toBe(0);
  });
});
