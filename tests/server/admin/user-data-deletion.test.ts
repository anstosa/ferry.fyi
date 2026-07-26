import { beforeEach, describe, expect, it, vi } from "vitest";

const transaction = { id: "deletion-transaction" };
const db = vi.hoisted(() => ({ transaction: vi.fn() }));
const privacy = vi.hoisted(() => ({ anonymizeLeaderboardAccount: vi.fn() }));
const revocation = vi.hoisted(() => ({ revokeApplicationTokens: vi.fn() }));
const settings = vi.hoisted(() => ({ destroy: vi.fn() }));
const allowlist = vi.hoisted(() => ({ destroy: vi.fn() }));

vi.mock("~/lib/db", () => ({ db }));
vi.mock("~/lib/leaderboardPrivacy", () => privacy);
vi.mock("~/lib/admin/sessionRevocation", () => revocation);
vi.mock("~/models/UserSettings", () => ({ UserSettings: settings }));
vi.mock("~/models/FeatureFlagAllowlist", () => ({
  FeatureFlagAllowlist: allowlist,
}));

import { deleteFerryUserData } from "../../../server/lib/admin/users";

describe("owner user-data deletion service", () => {
  beforeEach(() => {
    db.transaction.mockReset().mockImplementation(async (callback) => callback(transaction));
    privacy.anonymizeLeaderboardAccount
      .mockReset()
      .mockResolvedValue("deleted:123e4567-e89b-12d3-a456-426614174000");
    revocation.revokeApplicationTokens
      .mockReset()
      .mockResolvedValue({ expiresAt: "2026-07-25T00:00:00.000Z", status: "complete" });
    settings.destroy.mockReset().mockResolvedValue(1);
    allowlist.destroy.mockReset().mockResolvedValue(1);
  });

  it("writes the token revocation watermark before anonymizing and deleting app-owned identifiers", async () => {
    await expect(deleteFerryUserData("auth0|person")).resolves.toEqual({
      auth0Identity: "retained",
      status: "complete",
    });

    expect(revocation.revokeApplicationTokens).toHaveBeenCalledWith(
      "auth0|person",
      expect.any(Date),
      transaction
    );
    expect(privacy.anonymizeLeaderboardAccount).toHaveBeenCalledWith(
      "auth0|person",
      transaction
    );
    expect(settings.destroy).toHaveBeenCalledWith({
      transaction,
      where: { subject: "auth0|person" },
    });
    expect(allowlist.destroy).toHaveBeenCalledWith({
      transaction,
      where: { subject: "auth0|person" },
    });
    expect(privacy.anonymizeLeaderboardAccount.mock.invocationCallOrder[0]).toBeLessThan(
      settings.destroy.mock.invocationCallOrder[0]
    );
    expect(revocation.revokeApplicationTokens.mock.invocationCallOrder[0]).toBeLessThan(
      privacy.anonymizeLeaderboardAccount.mock.invocationCallOrder[0]
    );
  });

  it("does not delete identifiers if leaderboard anonymization fails", async () => {
    privacy.anonymizeLeaderboardAccount.mockRejectedValueOnce(
      new Error("anonymization failed")
    );

    await expect(deleteFerryUserData("auth0|person")).rejects.toThrow(
      "anonymization failed"
    );
    expect(settings.destroy).not.toHaveBeenCalled();
    expect(allowlist.destroy).not.toHaveBeenCalled();
  });

  it("does not anonymize or delete data if creating the revocation watermark fails", async () => {
    revocation.revokeApplicationTokens.mockRejectedValueOnce(
      new Error("revocation failed")
    );

    await expect(deleteFerryUserData("auth0|person")).rejects.toThrow(
      "revocation failed"
    );
    expect(privacy.anonymizeLeaderboardAccount).not.toHaveBeenCalled();
    expect(settings.destroy).not.toHaveBeenCalled();
    expect(allowlist.destroy).not.toHaveBeenCalled();
  });
});
