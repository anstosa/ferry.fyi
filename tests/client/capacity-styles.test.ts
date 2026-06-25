import { describe, expect, it } from "vitest";

import {
  getCapacityFillClassName,
  getCapacityOpacityClassName,
} from "../../client/views/Schedule/capacityStyles";

// capacity style contract
describe("getCapacityFillClassName", () => {
  // daylight loading fill
  it("uses the day confirmed token for confirmed daylight capacity", () => {
    expect(getCapacityFillClassName({ isDaylight: true, isFull: false })).toBe(
      "bg-day-confirmed-light dark:bg-day-confirmed-dark"
    );
  });

  // nighttime loading fill
  it("uses the night confirmed token for confirmed nighttime capacity", () => {
    expect(getCapacityFillClassName({ isDaylight: false, isFull: false })).toBe(
      "bg-night-confirmed-light dark:bg-night-confirmed-dark"
    );
  });

  // daylight full fill
  it("uses daylight stripes when a daylight sailing is full", () => {
    expect(getCapacityFillClassName({ isDaylight: true, isFull: true })).toBe(
      "bg-full-day"
    );
  });

  // nighttime full fill
  it("uses nighttime stripes when a nighttime sailing is full", () => {
    expect(getCapacityFillClassName({ isDaylight: false, isFull: true })).toBe(
      "bg-full-night"
    );
  });
  // past opacity
  it("fades confirmed capacity when the sailing has passed", () => {
    expect(getCapacityOpacityClassName({ hasDeparted: true })).toBe(
      "opacity-50"
    );
  });

  // future opacity
  it("keeps upcoming confirmed capacity fully opaque", () => {
    expect(getCapacityOpacityClassName({ hasDeparted: false })).toBe("");
  });
});
