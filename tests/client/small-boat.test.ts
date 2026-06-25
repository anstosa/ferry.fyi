import { describe, expect, it } from "vitest";

import {
  getCurrentRouteMaxVehicleCapacity,
  getRouteMaxVehicleCapacity,
  isSmallBoatCapacity,
} from "../../client/views/Schedule/smallBoat";

// small boat classification
describe("small boat schedule chip", () => {
  // below threshold
  it("marks a vessel small below ninety percent of the route maximum", () => {
    expect(isSmallBoatCapacity(80, 100)).toBe(true);
  });

  // threshold boundary
  it("does not mark a vessel small at exactly ninety percent", () => {
    expect(isSmallBoatCapacity(90, 100)).toBe(false);
  });

  // scheduled maximum
  it("uses the largest scheduled vessel capacity on the route", () => {
    expect(getCurrentRouteMaxVehicleCapacity([144, 188, undefined])).toBe(188);
  });

  // normal maximum fallback
  it("uses the larger of current and normal route maximums", () => {
    expect(getRouteMaxVehicleCapacity(188, 202)).toBe(202);
  });
});
