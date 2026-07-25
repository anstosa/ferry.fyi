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
});
