import { describe, expect, it } from "vitest";

import {
  isDelayBulletin,
  isSuppressedBulletin,
  isTidalCancellationBulletin,
} from "../../shared/lib/bulletins";

describe("bulletin helpers", () => {
  // suppress opinion-group promotions regardless of their source field
  it.each([
    { title: "All Routes - Join the Ferry Riders Opinion Group" },
    { title: "Join FROG", bodyText: "Join the ferry riders opinion group." },
    {
      title: "Tell us what you think",
      bodyHTML: "<p>Join the Ferry <strong>Riders</strong> Opinion Group.</p>",
    },
    { title: "Ferry Riders\nOpinion\u00a0Group recruitment" },
  ])("suppresses Ferry Riders Opinion Group alerts: $title", (bulletin) => {
    expect(isSuppressedBulletin(bulletin)).toBe(true);
  });

  // keep unrelated rider and group travel advisories
  it.each([
    "Ferry riders - Terminal loading changes",
    "Group travel advisory",
    "Share your opinion about terminal accessibility",
  ])("keeps unrelated advisories visible: %s", (title) => {
    expect(isSuppressedBulletin({ title })).toBe(false);
  });

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

  it("identifies WSF tidal cancellation alerts", () => {
    expect(
      isTidalCancellationBulletin({
        bodyHTML:
          "<p>The 8:30 a.m. sailing is cancelled due to tidal conditions.</p>",
        title: "Port Townsend/Coupeville - Tidal cancellation",
      })
    ).toBe(true);
  });

  it("suppresses app-managed tidal cancellation alerts", () => {
    expect(
      isSuppressedBulletin({
        bodyHTML:
          "<p>Low tide cancellations are expected on this route today.</p>",
        title: "Coupeville - Service Alert",
      })
    ).toBe(true);
  });

  it("keeps low-tide non-cancellation alerts visible", () => {
    expect(
      isSuppressedBulletin({
        bodyHTML:
          "<p>Trucks with low clearance may be restricted during extreme low tides.</p>",
        title: "Terminal travel advisory",
      })
    ).toBe(false);
  });
});
