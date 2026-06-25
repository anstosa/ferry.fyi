import { describe, expect, it } from "vitest";

import { formatVesselLength } from "../../client/views/Schedule/vesselProfile";

// vessel profile formatting
describe("vessel profile formatting", () => {
  // feet and inches rounding
  it("rounds vessel length up to the nearest whole foot", () => {
    expect(formatVesselLength("362' 3\"")).toBe("363 ft");
  });

  // whole foot passthrough
  it("drops inches from whole-foot lengths", () => {
    expect(formatVesselLength("310'")).toBe("310 ft");
  });
});
