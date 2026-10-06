import { describe, expect, it } from "vitest";

import { Bulletin } from "../../server/models/Bulletin";

describe("Bulletin seed serialization", () => {
  it("normalizes raw bundled WSF bulletins before the Alerts view receives them", () => {
    expect(
      Bulletin.serializeInput({
        bodyHTML: "<p>Slip closed</p>",
        date: 1_784_475_000,
        terminalId: "5",
        title: "Muk/Clin - Terminal construction",
        url: "/5/alerts",
      })
    ).toMatchObject({
      bodyText: "Slip closed",
      level: "high",
      title: "Terminal construction",
    });
  });

  // preserve link shape while removing known numeric landing paths
  it.each([
    ["/3/alerts", "/bainbridge/alerts"],
    ["/3/alerts?source=test#details", "/bainbridge/alerts?source=test#details"],
    ["https://ferry.fyi/3/alerts", "https://ferry.fyi/bainbridge/alerts"],
    [
      "https://dev.ferry.fyi/3/alerts",
      "https://dev.ferry.fyi/bainbridge/alerts",
    ],
    ["https://wsdot.wa.gov/3/alerts", "https://wsdot.wa.gov/3/alerts"],
    ["/5/alerts", "/5/alerts"],
    ["/bainbridge/alerts", "/bainbridge/alerts"],
    ["not a URL", "not a URL"],
  ])("normalizes seeded link %s to %s", (url, expected) => {
    expect(
      Bulletin.serializeInput({
        bodyHTML: "<p>Dock work</p>",
        date: 1,
        terminalId: "3",
        title: "Dock work",
        url,
      }).url
    ).toBe(expected);
  });
});
