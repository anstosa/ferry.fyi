import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const placementSources = {
  cameras: readFileSync("client/views/Cameras.tsx", "utf8"),
  fare: readFileSync("client/views/Fares.tsx", "utf8"),
  home: readFileSync("client/views/Home.tsx", "utf8"),
  navigation: readFileSync("client/views/Navigation.tsx", "utf8"),
  schedule: readFileSync("client/views/Schedule/index.tsx", "utf8"),
  terminal: readFileSync("client/views/TerminalDetails.tsx", "utf8"),
};

describe("advertising surfaces", () => {
  it.each(Object.entries(placementSources))(
    "renders the %s placement through the shared ad slot",
    (slot, source) => {
      expect(source).toContain("<AdSlot");
      expect(source).toContain(`slot="${slot}"`);
    }
  );

  // keep the settled placement above visible sailing history
  it("places the schedule ad before past sailings", () => {
    const source = placementSources.schedule;
    const boundaryIndex = source.indexOf("{hasScheduleAd ? (");
    const adIndex = source.indexOf("<AdSlot", boundaryIndex);
    const historyIndex = source.indexOf("data-past-sailings", boundaryIndex);

    expect(boundaryIndex).toBeGreaterThan(-1);
    expect(adIndex).toBeGreaterThan(boundaryIndex);
    expect(historyIndex).toBeGreaterThan(adIndex);
  });
});
