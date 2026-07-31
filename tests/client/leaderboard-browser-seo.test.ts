import { describe, expect, it } from "vitest";

import type { PublicSsrSnapshot } from "../../shared/contracts/ssr";
import {
  getLeaderboardsSeoMetadata,
  getTerminalLeaderboardSeoMetadata,
  getVesselLeaderboardSeoMetadata,
} from "../../shared/lib/seo";
import { resolveSnapshotSeo } from "../../client/views/PublicSsrPages";

const snapshotMetadata = (
  canonicalPath: string,
  description: string,
  robots: "index,follow" | "noindex,follow" = "index,follow"
): PublicSsrSnapshot["metadata"] => ({
  canonicalPath,
  description,
  robots,
  title: `Audited ${canonicalPath}`,
});

describe("browser leaderboard metadata", () => {
  it("uses the exact shared audited descriptions for every leaderboard type", () => {
    expect(getLeaderboardsSeoMetadata().description).toBe(
      "Browse public Ferry FYI terminal leaderboards based on eligible foreground check-ins, plus vessel pages where check-in rankings are not yet available."
    );
    expect(
      getTerminalLeaderboardSeoMetadata({
        id: "seattle",
        name: "Seattle",
      }).description
    ).toBe(
      "View public all-time, monthly, and weekly Ferry FYI rankings from eligible foreground check-ins at the Seattle Washington State Ferries terminal."
    );
    expect(
      getVesselLeaderboardSeoMetadata({
        id: "kaleetan",
        name: "Kaleetan",
      }).description
    ).toBe(
      "See the public Ferry FYI information page for WSF vessel Kaleetan; vessel check-ins and leaderboard rankings are not currently available."
    );
  });

  it("preserves persisted noindex metadata after hydration on the matching path", () => {
    const fallback = getTerminalLeaderboardSeoMetadata({
      id: "seattle",
      name: "Seattle",
    });
    const persisted = snapshotMetadata(
      fallback.canonicalPath,
      fallback.description,
      "noindex,follow"
    );

    expect(
      resolveSnapshotSeo(persisted, fallback, fallback.canonicalPath)
    ).toMatchObject({
      description: fallback.description,
      robots: "noindex,follow",
    });
  });

  it("does not leak the initial snapshot policy after browser navigation", () => {
    const initial = getLeaderboardsSeoMetadata();
    const next = getVesselLeaderboardSeoMetadata({
      id: "kaleetan",
      name: "Kaleetan",
    });
    const persisted = snapshotMetadata(
      initial.canonicalPath,
      initial.description,
      "noindex,follow"
    );

    expect(
      resolveSnapshotSeo(persisted, next, next.canonicalPath)
    ).toEqual(next);
  });
});
