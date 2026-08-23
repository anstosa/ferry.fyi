import { beforeEach, describe, expect, it, vi } from "vitest";

const transaction = { id: "deletion-transaction", LOCK: { UPDATE: "UPDATE" } };
// share deletion mocks
const db = vi.hoisted(() => ({ transaction: vi.fn() }));
const privacy = vi.hoisted(() => ({ anonymizeLeaderboardAccount: vi.fn() }));
// hoist policy locks
const policy = vi.hoisted(() => ({ lockLeaderboardAutomaticPolicy: vi.fn() }));
const revocation = vi.hoisted(() => ({
  lockSubjectAuthorization: vi.fn(),
  revokeApplicationTokens: vi.fn(),
}));
const supporter = vi.hoisted(() => ({ detachSupporterCustomer: vi.fn() }));
const supporterCustomer = vi.hoisted(() => ({ findOne: vi.fn() }));
const supporterWork = vi.hoisted(() => ({ findAll: vi.fn() }));
const supporterSubscription = vi.hoisted(() => ({ findAll: vi.fn() }));
const settings = vi.hoisted(() => ({ destroy: vi.fn() }));
const tickets = vi.hoisted(() => ({ destroy: vi.fn() }));
const allowlist = vi.hoisted(() => ({ destroy: vi.fn() }));
const auth0 = vi.hoisted(() => ({ deleteAuth0User: vi.fn() }));

// bind deletion dependencies
vi.mock("~/lib/db", () => ({ db }));
vi.mock("~/lib/leaderboardPrivacy", () => privacy);
// bind policy locks
vi.mock("~/lib/leaderboardAutomaticPolicy", () => policy);
vi.mock("~/lib/admin/sessionRevocation", () => revocation);
vi.mock("~/lib/supporter", () => supporter);
vi.mock("~/models/SupporterCustomer", () => ({
  SupporterCustomer: supporterCustomer,
}));
vi.mock("~/models/SupporterReconcileWork", () => ({
  SupporterReconcileWork: supporterWork,
}));
vi.mock("~/models/SupporterSubscription", () => ({
  SupporterSubscription: supporterSubscription,
}));
vi.mock("~/models/UserSettings", () => ({ UserSettings: settings }));
vi.mock("~/models/UserTicket", () => ({ UserTicket: tickets }));
vi.mock("~/models/FeatureFlagAllowlist", () => ({
  FeatureFlagAllowlist: allowlist,
}));
vi.mock("~/lib/auth0Admin", () => auth0);

import {
  ContinuingBillingAcknowledgementRequiredError,
  deleteFerryUserAccount,
  deleteFerryUserData,
} from "../../../server/lib/accountDeletion";

// cover ordered deletion
describe("owner user-data deletion service", () => {
  // reset deletion state
  beforeEach(() => {
    db.transaction
      .mockReset()
      // execute one fake transaction
      .mockImplementation((callback) => callback(transaction));
    privacy.anonymizeLeaderboardAccount
      .mockReset()
      .mockResolvedValue("deleted:123e4567-e89b-12d3-a456-426614174000");
    revocation.revokeApplicationTokens.mockReset().mockResolvedValue({
      expiresAt: "2026-07-25T00:00:00.000Z",
      status: "complete",
    });
    revocation.lockSubjectAuthorization.mockReset().mockResolvedValue(undefined);
    supporter.detachSupporterCustomer.mockReset().mockResolvedValue(undefined);
    supporterCustomer.findOne.mockReset().mockResolvedValue(null);
    supporterWork.findAll.mockReset().mockResolvedValue([]);
    supporterSubscription.findAll.mockReset().mockResolvedValue([]);
    policy.lockLeaderboardAutomaticPolicy.mockReset().mockResolvedValue({
      transaction,
    });
    settings.destroy.mockReset().mockResolvedValue(1);
    tickets.destroy.mockReset().mockResolvedValue(1);
    allowlist.destroy.mockReset().mockResolvedValue(1);
    auth0.deleteAuth0User.mockReset().mockResolvedValue(undefined);
  });

  // verify lock and deletion order
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
    expect(supporter.detachSupporterCustomer).toHaveBeenCalledWith(
      "auth0|person",
      transaction
    );
    expect(privacy.anonymizeLeaderboardAccount).toHaveBeenCalledWith(
      "auth0|person",
      transaction,
      { transaction }
    );
    expect(policy.lockLeaderboardAutomaticPolicy).toHaveBeenCalledWith(
      transaction,
      {
        lockCheckins: true,
        lockPresence: true,
        lockReceipts: true,
        subject: "auth0|person",
      }
    );
    expect(settings.destroy).toHaveBeenCalledWith({
      transaction,
      where: { subject: "auth0|person" },
    });
    expect(tickets.destroy).toHaveBeenCalledWith({
      transaction,
      where: { subject: "auth0|person" },
    });
    expect(allowlist.destroy).toHaveBeenCalledWith({
      transaction,
      where: { subject: "auth0|person" },
    });
    expect(
      privacy.anonymizeLeaderboardAccount.mock.invocationCallOrder[0]
    ).toBeLessThan(settings.destroy.mock.invocationCallOrder[0]);
    expect(
      policy.lockLeaderboardAutomaticPolicy.mock.invocationCallOrder[0]
    ).toBeLessThan(
      revocation.revokeApplicationTokens.mock.invocationCallOrder[0]
    );
    expect(
      revocation.revokeApplicationTokens.mock.invocationCallOrder[0]
    ).toBeLessThan(
      privacy.anonymizeLeaderboardAccount.mock.invocationCallOrder[0]
    );
  });

  // preserve identifiers on anonymization failure
  it("does not delete identifiers if leaderboard anonymization fails", async () => {
    privacy.anonymizeLeaderboardAccount.mockRejectedValueOnce(
      new Error("anonymization failed")
    );

    await expect(deleteFerryUserData("auth0|person")).rejects.toThrow(
      "anonymization failed"
    );
    expect(settings.destroy).not.toHaveBeenCalled();
    expect(tickets.destroy).not.toHaveBeenCalled();
    expect(allowlist.destroy).not.toHaveBeenCalled();
  });

  // preserve data on revocation failure
  it("does not anonymize or delete data if creating the revocation watermark fails", async () => {
    revocation.revokeApplicationTokens.mockRejectedValueOnce(
      new Error("revocation failed")
    );

    await expect(deleteFerryUserData("auth0|person")).rejects.toThrow(
      "revocation failed"
    );
    expect(privacy.anonymizeLeaderboardAccount).not.toHaveBeenCalled();
    expect(settings.destroy).not.toHaveBeenCalled();
    expect(tickets.destroy).not.toHaveBeenCalled();
    expect(allowlist.destroy).not.toHaveBeenCalled();
  });

  // delete identity after app data
  it("deletes the Auth0 identity after app-owned data inside one transaction", async () => {
    await expect(deleteFerryUserAccount("auth0|person")).resolves.toEqual({
      status: "complete",
    });

    expect(auth0.deleteAuth0User).toHaveBeenCalledWith("auth0|person");
    expect(settings.destroy.mock.invocationCallOrder[0]).toBeLessThan(
      auth0.deleteAuth0User.mock.invocationCallOrder[0]
    );
  });

  // require billing continuity acknowledgement
  it("blocks account deletion while continuing billing is unacknowledged", async () => {
    supporterCustomer.findOne.mockResolvedValueOnce({ id: "customer-1" });
    supporterWork.findAll.mockResolvedValueOnce([
      { environment: "production", state: "pending" },
    ]);

    await expect(deleteFerryUserAccount("auth0|person")).rejects.toBeInstanceOf(
      ContinuingBillingAcknowledgementRequiredError
    );
    expect(auth0.deleteAuth0User).not.toHaveBeenCalled();
    expect(settings.destroy).not.toHaveBeenCalled();
  });

  // surface identity deletion failure
  it("fails account deletion when Auth0 does not delete the identity", async () => {
    auth0.deleteAuth0User.mockRejectedValueOnce(
      new Error("Auth0 deletion failed")
    );

    await expect(deleteFerryUserAccount("auth0|person")).rejects.toThrow(
      "Auth0 deletion failed"
    );
  });
});
