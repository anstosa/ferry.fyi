import { describe, expect, it } from "vitest";

import {
  LEADERBOARD_CHECKIN_ANDROID_CHANNEL,
  LEADERBOARD_CHECKIN_NOTIFICATION_ID,
  formatLeaderboardCheckinBody,
  leaderboardCheckinAndroidChannel,
  leaderboardCheckinNotification,
  mergeLeaderboardCheckinNames,
} from "../../client/lib/leaderboardNotificationConfig";

describe("leaderboard check-in notification configuration", () => {
  it("uses an Android low-importance silent channel and a stable replacement ID", () => {
    expect(leaderboardCheckinAndroidChannel).toEqual({
      description: "Silent summaries of Ferry FYI leaderboard check-ins",
      id: "leaderboard-checkins-silent",
      importance: 2,
      lights: false,
      name: "Leaderboard check-ins",
      vibration: false,
    });
    expect(leaderboardCheckinNotification("Checked in.", "android")).toEqual({
      body: "Checked in.",
      channelId: LEADERBOARD_CHECKIN_ANDROID_CHANNEL,
      id: LEADERBOARD_CHECKIN_NOTIFICATION_ID,
      threadIdentifier: "leaderboard-checkins",
      title: "Ferry FYI check-in",
    });
  });

  it("merges a delivered native summary after restart when its body is available", () => {
    expect(
      mergeLeaderboardCheckinNames(
        "Bainbridge Island",
        "2 recent check-ins: Seattle, Bremerton."
      )
    ).toEqual(["Seattle", "Bremerton", "Bainbridge Island"]);
    expect(
      mergeLeaderboardCheckinNames("Bremerton", "Checked in at Seattle.")
    ).toEqual(["Seattle", "Bremerton"]);
  });

  it("keeps iOS delivery silent by omitting a sound and preserving its thread", () => {
    expect(leaderboardCheckinNotification("Checked in.", "ios")).toEqual({
      body: "Checked in.",
      channelId: undefined,
      id: LEADERBOARD_CHECKIN_NOTIFICATION_ID,
      threadIdentifier: "leaderboard-checkins",
      title: "Ferry FYI check-in",
    });
  });

  it("keeps terminal names out of notifications unless verbose mode is enabled", () => {
    expect(formatLeaderboardCheckinBody("Seattle", false)).toBe(
      "A Ferry FYI check-in was recorded."
    );
    expect(formatLeaderboardCheckinBody("Seattle", true, ["Seattle"])).toBe(
      "Checked in at Seattle."
    );
    expect(formatLeaderboardCheckinBody("Bremerton", false)).toBe(
      "A Ferry FYI check-in was recorded."
    );
  });
});
