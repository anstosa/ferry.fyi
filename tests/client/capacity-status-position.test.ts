import { describe, expect, it } from "vitest";

import { getCapacityStatusSide } from "../../client/views/Schedule/capacityStatusPosition";

const DEFAULT_OPTIONS = {
  linePercent: 40,
  margin: 16,
  rowPadding: 12,
  rowWidth: 390,
  statusWidth: 125,
  timeWidth: 64,
};

describe("getCapacityStatusSide", () => {
  it("places status on the right when it fits before the time column", () => {
    expect(getCapacityStatusSide(DEFAULT_OPTIONS)).toBe("right");
  });

  it("places status on the left when the right side would collide with time", () => {
    expect(getCapacityStatusSide({ ...DEFAULT_OPTIONS, linePercent: 70 })).toBe(
      "left"
    );
  });

  it("places status on the left when the line reaches the time column", () => {
    expect(
      getCapacityStatusSide({ ...DEFAULT_OPTIONS, linePercent: 100 })
    ).toBe("left");
  });

  it("defaults to the right before the row has been measured", () => {
    expect(getCapacityStatusSide({ ...DEFAULT_OPTIONS, rowWidth: 0 })).toBe(
      "right"
    );
  });
});
