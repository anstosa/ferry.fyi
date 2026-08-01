import { describe, expect, it } from "vitest";

import { getRouteTabClassName } from "../../client/views/Route";

describe("route tab backgrounds", () => {
  it("keeps the Fare background on the viewport-filling tab container", () => {
    const className = getRouteTabClassName("fare", "to-right");

    expect(className).toContain("route-tab-motion");
    expect(className).toContain("bg-day-normal-light");
    expect(className).toContain("dark:bg-night-normal-dark");
  });

  it("does not override backgrounds owned by other route tabs", () => {
    expect(getRouteTabClassName("schedule", "to-left")).not.toContain(
      "bg-day-normal-light"
    );
  });
});
