import { describe, expect, it, vi } from "vitest";

describe("leaderboard period selection", () => {
  it("checks week, month, then all time for the first non-empty leaderboard", async () => {
    const { getFirstNonEmptyLeaderboard } =
      await import("../../client/lib/leaderboards");
    const load = vi.fn((period) =>
      Promise.resolve({
        entityId: "terminal-1",
        period,
        ranks: period === "all" ? [{ label: "AS", rank: 1, score: 3 }] : [],
      })
    );

    await expect(getFirstNonEmptyLeaderboard(load)).resolves.toMatchObject({
      period: "all",
    });
    expect(load).toHaveBeenNthCalledWith(1, "week");
    expect(load).toHaveBeenNthCalledWith(2, "month");
    expect(load).toHaveBeenNthCalledWith(3, "all");
  });
});
