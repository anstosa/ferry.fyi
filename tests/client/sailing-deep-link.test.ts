import { describe, expect, it } from "vitest";

import {
  getSailingDeepLink,
  isDetailTab,
} from "../../client/lib/sailingDeepLink";

// sailing deep links
describe("sailing deep links", () => {
  // tab validation
  it("accepts only known sailing detail tabs", () => {
    expect(isDetailTab("sailing")).toBe(true);
    expect(isDetailTab("forecast")).toBe(true);
    expect(isDetailTab("vessel")).toBe(true);
    expect(isDetailTab("alerts")).toBe(false);
  });

  // link construction
  it("adds date, sailing, and tab query params", () => {
    const url = getSailingDeepLink({
      currentUrl: "https://ferry.fyi/mukilteo/clinton?date=2026-07-04",
      date: "2026-07-05",
      sailingTime: 1783267200,
      tab: "forecast",
    });

    expect(url).toBe(
      "https://ferry.fyi/mukilteo/clinton?date=2026-07-05&sailing=1783267200&tab=forecast"
    );
  });
});
