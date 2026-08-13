export const LEADERBOARD_CHECKIN_NOTIFICATION_ID = 902;
export const LEADERBOARD_CHECKIN_ANDROID_CHANNEL =
  "leaderboard-checkins-silent";

/** Supported check-in notification targets. */
export type LeaderboardCheckInKind = "terminal" | "vessel";

export const leaderboardCheckinAndroidChannel = {
  description: "Silent summaries of Ferry FYI leaderboard check-ins",
  id: LEADERBOARD_CHECKIN_ANDROID_CHANNEL,
  importance: 2 as const,
  lights: false,
  name: "Leaderboard check-ins",
  vibration: false,
};

export const leaderboardCheckinNotification = (
  body: string,
  platform: string
) => ({
  body,
  channelId:
    platform === "android" ? LEADERBOARD_CHECKIN_ANDROID_CHANNEL : undefined,
  id: LEADERBOARD_CHECKIN_NOTIFICATION_ID,
  // iOS has no sound unless a sound file is provided. Do not use its `silent`
  // flag because it would suppress foreground delivery instead of just audio.
  threadIdentifier: "leaderboard-checkins",
  title: "Ferry FYI check-in",
});

/** Format a private check-in summary with optional place details. */
export const formatLeaderboardCheckinBody = (
  entityName: string,
  verbose: boolean,
  entityNames: string[] = [],
  kind: LeaderboardCheckInKind = "terminal"
): string => {
  // preserve the legacy private summary
  if (!verbose) {
    return "A Ferry FYI check-in was recorded.";
  }
  // choose the target-specific preposition
  const preposition = kind === "vessel" ? "on" : "at";
  return entityNames.length === 1
    ? `Checked in ${preposition} ${entityName}.`
    : `${entityNames.length} recent check-ins: ${entityNames.join(", ")}.`;
};

/**
 * Extends a delivered check-in summary when a native OS exposes its body after
 * an app restart. If no body is available, callers can safely start fresh.
 */
export const mergeLeaderboardCheckinNames = (
  terminalName: string,
  deliveredBody?: string,
  currentNames: string[] = []
): string[] => {
  const deliveredSummary = deliveredBody?.match(
    /recent check-ins: (.+)\.$/
  )?.[1];
  const deliveredSingle = deliveredBody?.match(
    /Checked in (?:at|on) (.+)\.$/
  )?.[1];
  let deliveredNames: string[] = [];
  if (deliveredSummary) {
    deliveredNames = deliveredSummary.split(", ");
  } else if (deliveredSingle) {
    deliveredNames = [deliveredSingle];
  }

  return [...new Set([...deliveredNames, ...currentNames, terminalName])].slice(
    -5
  );
};
