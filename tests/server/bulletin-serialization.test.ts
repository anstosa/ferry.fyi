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
});
