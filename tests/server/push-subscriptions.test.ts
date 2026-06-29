import { beforeEach, describe, expect, it, vi } from "vitest";

const usersList = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth0", () => ({
  auth0: { users: { list: usersList } },
}));

import { getSubscribedTerminalPushMessages } from "~/lib/pushSubscriptions";

const makeUsers = (users: unknown[]) => ({
  async *[Symbol.asyncIterator]() {
    // user page fixture
    for (const user of users) {
      yield user;
    }
  },
});

describe("push subscriptions", () => {
  beforeEach(() => {
    usersList.mockReset();
  });

  it("matches route subscriptions by channel", async () => {
    usersList.mockResolvedValueOnce(
      makeUsers([
        {
          app_metadata: {
            alertSubscriptions: { "5:14": ["delays"] },
            fcmToken: "delay-token",
          },
          user_id: "delay-user",
        },
        {
          app_metadata: {
            alertSubscriptions: { "5:14": ["cancellations"] },
            fcmToken: "cancel-token",
          },
          user_id: "cancel-user",
        },
      ])
    );

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
    usersList.mockResolvedValueOnce(
      makeUsers([
        {
          app_metadata: {
            fcmToken: "legacy-token",
            subscribedTerminals: ["14"],
          },
          user_id: "legacy-user",
        },
      ])
    );

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
