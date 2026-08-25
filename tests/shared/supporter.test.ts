import { describe, expect, it } from "vitest";

import {
  getInactiveSupporterSummary,
  isSupporterRevision,
} from "../../shared/contracts/supporter";

describe("supporter contract", () => {
  it("accepts only canonical bounded projection revisions", () => {
    expect(isSupporterRevision("v1:0:1")).toBe(true);
    expect(isSupporterRevision("v1:9223372036854775807:1")).toBe(true);
    expect(isSupporterRevision("v1:01:1")).toBe(false);
    expect(isSupporterRevision("v1:9223372036854775808:1")).toBe(false);
    expect(isSupporterRevision("v2:0:1")).toBe(false);
  });

  it("builds a fail-closed inactive summary", () => {
    expect(getInactiveSupporterSummary("7")).toEqual({
      active: false,
      activeUntil: null,
      adsEnabled: false,
      lifecycleState: "none",
      resolved: true,
      revision: "v1:0:7",
    });
  });
});
