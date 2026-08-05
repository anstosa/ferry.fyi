import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.hoisted(() => ({ sendPush: vi.fn() }));
const userSettings = vi.hoisted(() => ({ findAll: vi.fn() }));

vi.mock("~/lib/push", () => push);
vi.mock("~/models/UserSettings", () => ({ UserSettings: userSettings }));

import { sendAdminNotification } from "../../../server/lib/admin/notificationSend";

describe("admin notification sends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BASE_URL = "https://ferry.fyi";
    userSettings.findAll.mockResolvedValue([
      {
        appMetadata: {
          alertRules: [{ channels: ["delays"], enabled: true, id: "commute" }],
          fcmToken: "fcm-token",
        },
        subject: "auth0|owner",
      },
    ]);
    push.sendPush.mockResolvedValue({ providerSubmission: "accepted" });
  });

  it("sends test notices with foreground data and background display fields", async () => {
    await expect(
      sendAdminNotification({
        body: "This is a push test.",
        mode: "test",
        subject: "auth0|owner",
        title: "Ferry FYI test",
      })
    ).resolves.toEqual({
      acceptedCount: 1,
      delivery: "not-confirmed",
      notSubmittedCount: 0,
      recipientCount: 1,
    });

    expect(push.sendPush).toHaveBeenCalledWith({
      android: { priority: "high" },
      data: {
        body: "This is a push test.",
        title: "Ferry FYI test",
        type: "admin-notice",
        url: "https://ferry.fyi",
        userId: "auth0|owner",
      },
      notification: {
        body: "This is a push test.",
        title: "Ferry FYI test",
      },
      token: "fcm-token",
      webpush: { fcmOptions: { link: "https://ferry.fyi/" } },
    });
  });
});
