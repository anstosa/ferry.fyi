import { describe, expect, it } from "vitest";

import { isDelayBulletin } from "../../shared/lib/bulletins";

describe("bulletin helpers", () => {
  it("identifies WSF sailing delay alerts", () => {
    expect(
      isDelayBulletin({
        bodyHTML: "<p>The 9:40 p.m. sailing is delayed 20 minutes.</p>",
        title: "Kingston/Edmonds - Update",
      })
    ).toBe(true);
  });

  it("identifies WSF vessel running-late alerts", () => {
    expect(
      isDelayBulletin({
        bodyHTML: "",
        title: "Mukilteo/Clinton - Tokitae is running 17 minutes late",
      })
    ).toBe(true);
  });

  it("keeps non-sailing delayed-service alerts visible", () => {
    expect(
      isDelayBulletin({
        bodyHTML:
          "<p>The 9:40 p.m. sailing may also affect later sailings.</p>",
        title: "Kingston terminal construction delayed Tues-Thurs",
      })
    ).toBe(false);
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
