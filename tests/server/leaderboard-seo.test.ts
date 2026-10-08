import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { filterLeaderboardLlms } from "../../server/lib/leaderboardSeo";
import {
  getTerminalLeaderboardSeoMetadata,
  getVesselLeaderboardSeoMetadata,
} from "../../shared/lib/seo";

const llms = `before
<!-- LEADERBOARDS:START -->
leaderboard content
<!-- LEADERBOARDS:END -->
after`;

describe("leaderboard discovery metadata", () => {
  // retain bounded documentation for tasks and safe data interpretation
  it("keeps the guide concise without dropping task or safety sections", () => {
    const source = readFileSync("client/static/llms.txt", "utf8");
    expect(source.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(
      2000
    );
    // preserve the requested documentation boundaries
    for (const heading of [
      "## Tasks",
      "### Examples",
      "## Freshness",
      "## Safe AI use",
      "## Citation guidance",
    ]) {
      expect(source).toContain(heading);
    }
  });

  it("builds canonical public entity paths", () => {
    expect(
      getTerminalLeaderboardSeoMetadata({ id: "seattle", name: "Seattle" })
        .canonicalPath
    ).toBe("/leaderboards/terminals/seattle");
    expect(
      getVesselLeaderboardSeoMetadata({ id: "kaleetan", name: "Kaleetan" })
        .canonicalPath
    ).toBe("/leaderboards/vessels/kaleetan");
  });

  it("removes leaderboard documentation when the feature is disabled", () => {
    expect(filterLeaderboardLlms(llms, false)).toBe("before\nafter");
    expect(filterLeaderboardLlms(llms, true)).toContain("leaderboard content");
    expect(filterLeaderboardLlms(llms, true)).not.toContain("LEADERBOARDS:");
  });

  it("keeps route-purpose guidance outside the leaderboard visibility gate", () => {
    const source = readFileSync("client/static/llms.txt", "utf8");
    const disabled = filterLeaderboardLlms(source, false);
    expect(disabled).toContain("Canonical schedule pages are directional");
    expect(disabled).toContain("`/cameras` shows camera observations");
    expect(disabled).not.toContain("### Leaderboards");
    expect(filterLeaderboardLlms(source, true)).toContain(
      "separate persisted indexing"
    );
  });
});
