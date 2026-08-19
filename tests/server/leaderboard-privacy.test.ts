import { beforeEach, describe, expect, it, vi } from "vitest";

const transaction = { id: "privacy-transaction" };
// hoist policy seams
const automaticPolicy = vi.hoisted(() => ({
  advanceServerPolicyGeneration: vi.fn(),
  withLeaderboardAutomaticPolicyTransaction: vi.fn(),
}));
// hoist receipt seams
const receipts = vi.hoisted(() => ({ destroy: vi.fn() }));
// hoist enrollment seams
const enrollments = vi.hoisted(() => ({ destroy: vi.fn() }));
// hoist check-in seams
const checkins = vi.hoisted(() => ({ update: vi.fn() }));
// hoist profile seams
const profiles = vi.hoisted(() => ({ destroy: vi.fn() }));
// hoist presence seams
const presence = vi.hoisted(() => ({ destroy: vi.fn() }));
// hoist anonymization seams
const leaderboards = vi.hoisted(() => ({
  anonymizedLeaderboardSubject: vi.fn(
    () => "deleted:123e4567-e89b-12d3-a456-426614174000"
  ),
}));

// bind policy seams
vi.mock("~/lib/leaderboardAutomaticPolicy", () => automaticPolicy);
// bind anonymization seams
vi.mock("~/lib/leaderboards", () => leaderboards);
// bind receipt seams
vi.mock("~/models/LeaderboardAutomaticCandidateReceipt", () => ({
  LeaderboardAutomaticCandidateReceipt: receipts,
}));
// bind enrollment seams
vi.mock("~/models/LeaderboardAutomaticEnrollment", () => ({
  LeaderboardAutomaticEnrollment: enrollments,
}));
// bind check-in seams
vi.mock("~/models/LeaderboardCheckin", () => ({
  LeaderboardCheckin: checkins,
}));
// bind profile seams
vi.mock("~/models/LeaderboardProfile", () => ({
  LeaderboardProfile: profiles,
}));
// bind presence seams
vi.mock("~/models/LeaderboardTerminalPresence", () => ({
  LeaderboardTerminalPresence: presence,
}));

import { anonymizeLeaderboardAccount } from "../../server/lib/leaderboardPrivacy";

// cover leaderboard identity deletion
describe("leaderboard identity deletion hook", () => {
  // reset deletion seams
  beforeEach(() => {
    vi.clearAllMocks();
    const runPolicyTransaction =
      automaticPolicy.withLeaderboardAutomaticPolicyTransaction;
    // execute policy transactions inline
    runPolicyTransaction.mockImplementation(
      async (_options, callback) =>
        await callback({
          automaticFlag: { serverPolicyGeneration: 0 },
          enrollments: [{ enrollmentId: "enrollment-1" }],
          transaction,
        })
    );
    automaticPolicy.advanceServerPolicyGeneration.mockResolvedValue(1);
    receipts.destroy.mockResolvedValue(1);
    enrollments.destroy.mockResolvedValue(1);
    checkins.update.mockResolvedValue([1]);
    profiles.destroy.mockResolvedValue(1);
    presence.destroy.mockResolvedValue(1);
  });

  // prove native deletion and score retention
  it("removes native links then retains scores under a replacement identity", async () => {
    await anonymizeLeaderboardAccount("auth0|person");

    expect(
      automaticPolicy.withLeaderboardAutomaticPolicyTransaction
    ).toHaveBeenCalledWith(
      {
        lockCheckins: true,
        lockPresence: true,
        lockReceipts: true,
        subject: "auth0|person",
      },
      expect.any(Function)
    );
    expect(receipts.destroy).toHaveBeenCalledWith({
      transaction,
      where: { enrollmentId: expect.any(Object) },
    });
    expect(enrollments.destroy).toHaveBeenCalledWith({
      transaction,
      where: { subject: "auth0|person" },
    });
    expect(checkins.update).toHaveBeenCalledWith(
      { subject: expect.stringMatching(/^deleted:[0-9a-f-]{36}$/) },
      { transaction, where: { subject: "auth0|person" } }
    );
    expect(profiles.destroy).toHaveBeenCalledWith({
      transaction,
      where: { subject: "auth0|person" },
    });
    expect(presence.destroy).toHaveBeenCalledWith({
      transaction,
      where: { subject: "auth0|person" },
    });
    expect(receipts.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      enrollments.destroy.mock.invocationCallOrder[0]
    );
    expect(enrollments.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      checkins.update.mock.invocationCallOrder[0]
    );
    expect(
      automaticPolicy.advanceServerPolicyGeneration
    ).toHaveBeenCalledOnce();
  });
});
