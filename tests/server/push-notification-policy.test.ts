import { beforeEach, describe, expect, it, vi } from "vitest";

const policy = vi.hoisted(() => ({ getNotificationPolicy: vi.fn() }));
const status = vi.hoisted(() => ({
  notificationDequeued: vi.fn(),
  notificationFinished: vi.fn(),
  notificationQueued: vi.fn(),
}));
const firebase = vi.hoisted(() => ({
  firebaseMessaging: { send: vi.fn() },
  hasFirebaseCode: vi.fn(() => false),
}));

vi.mock("~/lib/admin/notificationPolicy", () => policy);
vi.mock("~/lib/admin/notificationStatus", () => status);
vi.mock("~/lib/firebase", () => firebase);
vi.mock("~/lib/time", () => ({ delay: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/models/UserSettings", () => ({
  UserSettings: { findByPk: vi.fn() },
}));

import { sendPush } from "../../server/lib/push";

describe("final push provider boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    policy.getNotificationPolicy.mockResolvedValue({ paused: false });
    firebase.firebaseMessaging.send.mockResolvedValue("firebase-id");
  });

  it("submits only when the database-backed global policy is unpaused", async () => {
    await expect(sendPush({ token: "test-token" })).resolves.toEqual({
      providerSubmission: "accepted",
    });
    expect(policy.getNotificationPolicy).toHaveBeenCalledTimes(1);
    expect(firebase.firebaseMessaging.send).toHaveBeenCalledWith({
      token: "test-token",
    });
    expect(status.notificationFinished).toHaveBeenCalledWith("accepted");
  });

  it("suppresses queued automated sends at the final provider boundary", async () => {
    policy.getNotificationPolicy.mockResolvedValue({ paused: true });

    await expect(sendPush({ token: "test-token" })).resolves.toEqual({
      providerSubmission: "not-submitted",
      reason: "paused",
    });
    expect(firebase.firebaseMessaging.send).not.toHaveBeenCalled();
    expect(status.notificationFinished).toHaveBeenCalledWith("paused");
  });

  it("rechecks the pause policy before retrying a failed provider submission", async () => {
    firebase.firebaseMessaging.send.mockRejectedValueOnce(
      new Error("temporary")
    );
    policy.getNotificationPolicy
      .mockResolvedValueOnce({ paused: false })
      .mockResolvedValueOnce({ paused: true });

    await expect(sendPush({ token: "test-token" })).resolves.toEqual({
      providerSubmission: "not-submitted",
      reason: "paused",
    });
    expect(firebase.firebaseMessaging.send).toHaveBeenCalledTimes(1);
    expect(policy.getNotificationPolicy).toHaveBeenCalledTimes(2);
  });

  it("fails closed instead of sending when policy storage is unavailable", async () => {
    policy.getNotificationPolicy.mockRejectedValue(
      new Error("database unavailable")
    );

    await expect(sendPush({ token: "test-token" })).resolves.toEqual({
      providerSubmission: "not-submitted",
      reason: "unavailable",
    });
    expect(firebase.firebaseMessaging.send).not.toHaveBeenCalled();
  });
});
