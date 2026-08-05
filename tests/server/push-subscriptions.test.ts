import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const userSettings = vi.hoisted(() => ({
  findAll: vi.fn(),
}));

vi.mock("~/models/UserSettings", () => ({
  UserSettings: userSettings,
}));

import {
  getSubscribedTerminalPushMessages,
  removeCompletedOneTimeSailingAlertRules,
} from "~/lib/pushSubscriptions";

// user settings fixture
const makeSettings = (
  subject: string,
  appMetadata: Record<string, unknown>
) => {
  const settings = {
    appMetadata,
    subject,
    update: vi.fn(async (data: { appMetadata: Record<string, unknown> }) => {
      settings.appMetadata = data.appMetadata;
      return settings;
    }),
  };
  return settings;
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

  it("adds display and deep-link fields to complete alert messages", async () => {
    userSettings.findAll.mockResolvedValueOnce([
      makeSettings("delay-user", {
        alertSubscriptions: { "5:14": ["delays"] },
        fcmToken: "delay-token",
      }),
    ]);

    const messages = await getSubscribedTerminalPushMessages({
      channel: "delays",
      data: {
        body: "Tokitae is delayed",
        title: "Mukilteo/Clinton delay",
        url: "https://ferry.fyi/mukilteo/clinton",
      },
      terminalIds: ["14", "5"],
    });

    expect(messages).toEqual([
      {
        android: { priority: "high" },
        data: {
          body: "Tokitae is delayed",
          title: "Mukilteo/Clinton delay",
          url: "https://ferry.fyi/mukilteo/clinton",
          userId: "delay-user",
        },
        notification: {
          body: "Tokitae is delayed",
          title: "Mukilteo/Clinton delay",
        },
        token: "delay-token",
        webpush: {
          fcmOptions: { link: "https://ferry.fyi/mukilteo/clinton" },
        },
      },
    ]);
  });

  it("matches scheduled alert rules by direction, day, time, and channel", async () => {
    userSettings.findAll.mockResolvedValueOnce([
      makeSettings("commuter", {
        alertRules: [
          {
            channels: ["delays"],
            daysOfWeek: [1, 2, 3, 4, 5],
            endTime: "07:30",
            id: "morning",
            routeKey: "14:5",
            startTime: "06:00",
            terminalIds: ["14"],
          },
        ],
        fcmToken: "commuter-token",
      }),
      makeSettings("wrong-direction", {
        alertRules: [
          {
            channels: ["delays"],
            daysOfWeek: [1, 2, 3, 4, 5],
            endTime: "07:30",
            id: "reverse",
            routeKey: "14:5",
            startTime: "06:00",
            terminalIds: ["5"],
          },
        ],
        fcmToken: "reverse-token",
      }),
    ]);

    const messages = await getSubscribedTerminalPushMessages({
      channel: "delays",
      data: { title: "Delay" },
      departureTerminalId: "14",
      departureTimes: [DateTime.fromISO("2026-07-06T06:45:00").toSeconds()],
      terminalIds: ["14", "5"],
    });

    expect(messages).toEqual([
      {
        data: { title: "Delay", userId: "commuter" },
        token: "commuter-token",
      },
    ]);
  });

  it("matches sailing update messages only for one-time sailing rules", async () => {
    userSettings.findAll.mockResolvedValueOnce([
      makeSettings("single-sailing", {
        alertRules: [
          {
            channels: ["delays"],
            date: "2026-07-06",
            daysOfWeek: [1],
            endTime: "06:45",
            id: "single",
            routeKey: "14:5",
            startTime: "06:45",
            terminalIds: ["14"],
          },
        ],
        fcmToken: "single-token",
      }),
      makeSettings("recurring-route", {
        alertRules: [
          {
            channels: ["sailing-updates"],
            daysOfWeek: [1, 2, 3, 4, 5],
            endTime: "24:00",
            id: "recurring",
            routeKey: "14:5",
            startTime: "00:00",
            terminalIds: ["14"],
          },
        ],
        fcmToken: "recurring-token",
      }),
    ]);

    const messages = await getSubscribedTerminalPushMessages({
      channel: "sailing-updates",
      data: { title: "Boarding" },
      departureTerminalId: "14",
      departureTimes: [DateTime.fromISO("2026-07-06T06:45:00").toSeconds()],
      oneTimeOnly: true,
      terminalIds: ["14", "5"],
    });

    expect(messages).toEqual([
      {
        data: { title: "Boarding", userId: "single-sailing" },
        token: "single-token",
      },
    ]);
  });

  it("matches a one-sailing alert rule when start and end are the same", async () => {
    userSettings.findAll.mockResolvedValueOnce([
      makeSettings("single-sailing", {
        alertRules: [
          {
            channels: ["delays"],
            daysOfWeek: [1, 2, 3, 4, 5],
            endTime: "06:45",
            id: "single",
            routeKey: "14:5",
            startTime: "06:45",
            terminalIds: ["14"],
          },
        ],
        fcmToken: "single-token",
      }),
    ]);

    const messages = await getSubscribedTerminalPushMessages({
      channel: "delays",
      data: { title: "Delay" },
      departureTerminalId: "14",
      departureTimes: [DateTime.fromISO("2026-07-06T06:45:00").toSeconds()],
      terminalIds: ["14", "5"],
    });

    expect(messages).toEqual([
      {
        data: { title: "Delay", userId: "single-sailing" },
        token: "single-token",
      },
    ]);
  });

  // one-time sailing date
  it("matches dated one-time sailing rules only on the selected day", async () => {
    const settings = [
      makeSettings("single-day-sailing", {
        alertRules: [
          {
            channels: ["delays"],
            date: "2026-07-06",
            daysOfWeek: [1],
            endTime: "06:45",
            id: "single-day",
            routeKey: "14:5",
            startTime: "06:45",
            terminalIds: ["14"],
          },
        ],
        fcmToken: "single-day-token",
      }),
    ];
    userSettings.findAll.mockResolvedValueOnce(settings);

    const selectedDayMessages = await getSubscribedTerminalPushMessages({
      channel: "delays",
      data: { title: "Delay" },
      departureTerminalId: "14",
      departureTimes: [DateTime.fromISO("2026-07-06T06:45:00").toSeconds()],
      terminalIds: ["14", "5"],
    });

    userSettings.findAll.mockResolvedValueOnce(settings);

    const nextWeekMessages = await getSubscribedTerminalPushMessages({
      channel: "delays",
      data: { title: "Delay" },
      departureTerminalId: "14",
      departureTimes: [DateTime.fromISO("2026-07-13T06:45:00").toSeconds()],
      terminalIds: ["14", "5"],
    });

    expect(selectedDayMessages).toEqual([
      {
        data: { title: "Delay", userId: "single-day-sailing" },
        token: "single-day-token",
      },
    ]);
    expect(nextWeekMessages).toEqual([]);
  });

  // completed sailing cleanup
  it("removes a completed sailing rule without removing later sailings", async () => {
    const completedRule = {
      channels: ["delays", "cancellations", "sailing-updates"] as const,
      date: "2026-07-06",
      daysOfWeek: [1],
      endTime: "06:45",
      id: "completed-sailing",
      routeKey: "14:5",
      startTime: "06:45",
      terminalIds: ["14"],
    };
    const laterRule = {
      ...completedRule,
      endTime: "08:15",
      id: "later-sailing",
      startTime: "08:15",
    };
    const selectedUser = makeSettings("selected-sailing", {
      alertRules: [completedRule, laterRule],
      fcmToken: "selected-token",
    });
    const otherUser = makeSettings("other-sailing", {
      alertRules: [completedRule],
      fcmToken: "other-token",
    });
    userSettings.findAll.mockResolvedValueOnce([selectedUser, otherUser]);

    await removeCompletedOneTimeSailingAlertRules({
      routeKey: "14:5",
      sailingTime: DateTime.fromISO("2026-07-06T06:45:00", {
        zone: "America/Los_Angeles",
      }),
      terminalId: "14",
    });

    expect(selectedUser.update).toHaveBeenCalledWith({
      appMetadata: {
        alertRules: [laterRule],
        fcmToken: "selected-token",
      },
    });
    expect(otherUser.update).toHaveBeenCalledWith({
      appMetadata: {
        alertRules: [],
        fcmToken: "other-token",
      },
    });
  });

  it("uses the current time for terminal alerts without a sailing", async () => {
    userSettings.findAll.mockResolvedValueOnce([
      makeSettings("service-user", {
        alertRules: [
          {
            channels: ["service-alerts"],
            daysOfWeek: [1, 2, 3, 4, 5],
            endTime: "17:00",
            id: "afternoon",
            routeKey: "14:5",
            startTime: "15:30",
            terminalIds: ["5"],
          },
        ],
        fcmToken: "service-token",
      }),
    ]);

    const messages = await getSubscribedTerminalPushMessages({
      channel: "service-alerts",
      currentTime: DateTime.fromISO("2026-07-06T16:00:00"),
      data: { title: "Service" },
      terminalIds: ["5"],
    });

    expect(messages).toEqual([
      {
        data: { title: "Service", userId: "service-user" },
        token: "service-token",
      },
    ]);
  });

  it("converts old multi-stop terminal alerts into pair matches", async () => {
    userSettings.findAll.mockResolvedValueOnce([
      makeSettings("old-anacortes-user", {
        fcmToken: "old-anacortes-token",
        subscribedTerminals: ["1"],
      }),
    ]);

    const messages = await getSubscribedTerminalPushMessages({
      channel: "delays",
      data: { title: "Delay" },
      departureTerminalId: "1",
      terminalIds: ["1", "13"],
    });

    expect(messages).toEqual([
      {
        data: { title: "Delay", userId: "old-anacortes-user" },
        token: "old-anacortes-token",
      },
    ]);
  });

  it("converts old terminal alerts before matching channels", async () => {
    userSettings.findAll.mockResolvedValueOnce([
      makeSettings("old-terminal-user", {
        fcmToken: "old-terminal-token",
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
        data: { title: "Cancellation", userId: "old-terminal-user" },
        token: "old-terminal-token",
      },
    ]);
  });
});
