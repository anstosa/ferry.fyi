import { describe, expect, it } from "vitest";

import { isDelayBulletin } from "../../shared/lib/bulletins";

describe("bulletin helpers", () => {
  it("identifies WSF delay alerts", () => {
    expect(
      isDelayBulletin({
        bodyHTML:
          "<p>The 9:40 p.m. sailing may also affect later sailings.</p>",
        title: "Kingston terminal construction delayed Tues-Thurs",
      })
    ).toBe(true);
  });

  it("keeps non-delay service alerts visible", () => {
    expect(
      isDelayBulletin({
        bodyHTML: "<p>Use caution near construction equipment.</p>",
        title: "Terminal construction update",
      })
    ).toBe(false);
  });
});
