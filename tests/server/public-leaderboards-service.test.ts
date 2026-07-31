import { beforeEach, describe, expect, it, vi } from "vitest";

const checkins = vi.hoisted(() => ({ findAll: vi.fn() }));
const profiles = vi.hoisted(() => ({ findAll: vi.fn() }));
const db = vi.hoisted(() => ({
  col: vi.fn((value: string) => value),
  fn: vi.fn((name: string, value: string) => `${name}(${value})`),
  literal: vi.fn((value: string) => value),
}));
const flags = vi.hoisted(() => ({ leaderboardsEnabled: vi.fn() }));

vi.mock("~/lib/db", () => ({ db }));
vi.mock("~/lib/leaderboardFlags", () => flags);
vi.mock("~/models/LeaderboardCheckin", () => ({
  LeaderboardCheckin: checkins,
}));
vi.mock("~/models/LeaderboardProfile", () => ({
  LeaderboardProfile: profiles,
}));

import {
  getPublicLeaderboard,
  parsePublicLeaderboardPeriod,
  publicLeaderboardsEnabled,
} from "../../server/services/public/leaderboards";

describe("public leaderboard query service", () => {
  beforeEach(() => {
    checkins.findAll.mockReset();
    profiles.findAll.mockReset();
    flags.leaderboardsEnabled.mockReset();
  });

  it("accepts only public period values", () => {
    expect(parsePublicLeaderboardPeriod("week")).toBe("week");
    expect(parsePublicLeaderboardPeriod("today")).toBeNull();
    expect(parsePublicLeaderboardPeriod(["all"])).toBeNull();
  });

  it("uses the global public feature evaluation, never a subject allowlist", async () => {
    flags.leaderboardsEnabled.mockResolvedValue(true);
    await expect(publicLeaderboardsEnabled()).resolves.toBe(true);
    expect(flags.leaderboardsEnabled).toHaveBeenCalledOnce();
  });

  it("filters opted-out profiles before ranking and caps eligible results", async () => {
    checkins.findAll.mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        score: String(20 - index),
        subject: `subject-${index}`,
      }))
    );
    profiles.findAll.mockResolvedValue([
      {
        displayName: "Ada Lovelace",
        optedOut: false,
        subject: "subject-0",
        useFullName: false,
      },
      {
        displayName: "Hidden Person",
        optedOut: true,
        subject: "subject-1",
        useFullName: true,
      },
    ]);

    await expect(
      getPublicLeaderboard({
        entityId: "terminal-1",
        kind: "terminal",
        period: "all",
      })
    ).resolves.toEqual({
      entityId: "terminal-1",
      period: "all",
      ranks: [
        { label: "AL", rank: 1, score: 20 },
        ...Array.from({ length: 9 }, (_, index) => ({
          label: "Anonymous",
          rank: index + 2,
          score: 18 - index,
        })),
      ],
    });
    expect(checkins.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { entityId: "terminal-1", kind: "terminal" },
      })
    );
    expect(profiles.findAll).toHaveBeenCalledWith({
      where: {
        subject: expect.any(Object),
      },
    });
  });
});
