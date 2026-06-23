import { describe, expect, it } from "vitest";

import { shouldUseForecastCapacityStatus } from "../../client/views/Schedule/capacityDisplaySource";

const DEFAULT_OPTIONS = {
  hasDeparted: false,
  hasForecastCapacity: true,
  hasLiveCapacity: true,
  isLiveCapacityEmpty: false,
};

// capacity status source
describe("shouldUseForecastCapacityStatus", () => {
  // live empty future case
  it("uses forecast status for future sailings when live capacity reports empty", () => {
    expect(
      shouldUseForecastCapacityStatus({
        ...DEFAULT_OPTIONS,
        isLiveCapacityEmpty: true,
      })
    ).toBe(true);
  });

  // missing live future case
  it("uses forecast status for future sailings without live capacity", () => {
    expect(
      shouldUseForecastCapacityStatus({
        ...DEFAULT_OPTIONS,
        hasLiveCapacity: false,
      })
    ).toBe(true);
  });

  // useful live case
  it("keeps live status when future live capacity is non-empty", () => {
    expect(shouldUseForecastCapacityStatus(DEFAULT_OPTIONS)).toBe(false);
  });

  // historical case
  it("keeps live status for departed sailings", () => {
    expect(
      shouldUseForecastCapacityStatus({
        ...DEFAULT_OPTIONS,
        hasDeparted: true,
        isLiveCapacityEmpty: true,
      })
    ).toBe(false);
  });
});
