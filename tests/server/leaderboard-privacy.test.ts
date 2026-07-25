import { beforeEach, describe, expect, it, vi } from "vitest";

const checkins = vi.hoisted(() => ({ update: vi.fn() }));
const profiles = vi.hoisted(() => ({ destroy: vi.fn() }));
const presence = vi.hoisted(() => ({ destroy: vi.fn() }));
const leaderboards = vi.hoisted(() => ({
  anonymizedLeaderboardSubject: vi.fn(
    () => "deleted:123e4567-e89b-12d3-a456-426614174000"
  ),
}));

vi.mock("~/lib/leaderboards", () => leaderboards);
vi.mock("~/models/LeaderboardCheckin", () => ({
  LeaderboardCheckin: checkins,
}));
vi.mock("~/models/LeaderboardProfile", () => ({
  LeaderboardProfile: profiles,
}));
vi.mock("~/models/LeaderboardTerminalPresence", () => ({
  LeaderboardTerminalPresence: presence,
}));

import { anonymizeLeaderboardAccount } from "../../server/lib/leaderboardPrivacy";

describe("leaderboard identity deletion hook", () => {
  beforeEach(() => {
    checkins.update.mockReset().mockResolvedValue([1]);
    profiles.destroy.mockReset().mockResolvedValue(1);
    presence.destroy.mockReset().mockResolvedValue(1);
  });

  it("retains check-ins under a replacement identity and removes live identity state", async () => {
    await anonymizeLeaderboardAccount("auth0|person");
    expect(checkins.update).toHaveBeenCalledWith(
      { subject: expect.stringMatching(/^deleted:[0-9a-f-]{36}$/) },
      { transaction: undefined, where: { subject: "auth0|person" } }
    );
    expect(profiles.destroy).toHaveBeenCalledWith({
      transaction: undefined,
      where: { subject: "auth0|person" },
    });
    expect(presence.destroy).toHaveBeenCalledWith({
      transaction: undefined,
      where: { subject: "auth0|person" },
    });
  });
});
