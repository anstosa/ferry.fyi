import { beforeEach, describe, expect, it, vi } from "vitest";

const userSettings = vi.hoisted(() => ({
  findAll: vi.fn(),
}));

vi.mock("~/models/UserSettings", () => ({
  UserSettings: userSettings,
}));

import { getSubscribedTerminalPushMessages } from "~/lib/pushSubscriptions";

// user settings fixture
const makeSettings = (subject: string, appMetadata: Record<string, unknown>) => {
  return { appMetadata, subject };
};

describe("push subscriptions", () => {
  beforeEach(() => {
    userSettings.findAll.mockReset();
  });

  it("matches route subscriptions by channel", async () => {
    userSettings.findAll.mockResolvedValueOnce([
      makeSettings("delay-user", {
        alertSubscriptions: { "5:14": ["delays"] },
        fcmToken: "delay-token",
      }),
      makeSettings("cancel-user", {
        alertSubscriptions: { "5:14": ["cancellations"] },
        fcmToken: "cancel-token",
      }),
    ]);

    const messages = await getSubscribedTerminalPushMessages({
      channel: "delays",
      data: { title: "Delay" },
      terminalIds: ["14", "5"],
    });

    expect(messages).toEqual([
      {
        data: { title: "Delay", userId: "delay-user" },
        token: "delay-token",
      },
    ]);
  });

  it("keeps legacy terminal subscriptions subscribed to all channels", async () => {
    userSettings.findAll.mockResolvedValueOnce([
      makeSettings("legacy-user", {
        fcmToken: "legacy-token",
        subscribedTerminals: ["14"],
      }),
    ]);

    const messages = await getSubscribedTerminalPushMessages({
      channel: "cancellations",
      data: { title: "Cancellation" },
      terminalIds: ["14", "5"],
    });

    expect(messages).toEqual([
      {
        data: { title: "Cancellation", userId: "legacy-user" },
        token: "legacy-token",
      },
    ]);
  });
});
