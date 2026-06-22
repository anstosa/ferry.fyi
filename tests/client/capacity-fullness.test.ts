import { describe, expect, it } from "vitest";

import {
  getCapacityDisplayPercent,
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
});
