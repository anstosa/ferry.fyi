import { requestCurrentLocation } from "./geo";
import { requestNotificationPermission } from "./push";

export const LEADERBOARD_LOCATION_ENROLLMENT_STORAGE_KEY =
  "leaderboardLocationEnrollment";
export const LEADERBOARD_LOCATION_ENROLLMENT_CHANGED =
  "leaderboard-location-enrollment-changed";

export type EnrollmentChoice = "unprompted" | "enrolled" | "declined";
export type LocationAccess = "unknown" | "granted" | "unavailable";
export type NotificationAccess = "unknown" | "granted" | "unavailable";

/**
 * This is intentionally limited to consent and permission outcomes. Location
 * coordinates must never be added here: foreground check-ins discard them.
 */
export interface LeaderboardLocationEnrollmentState {
  enrollment: EnrollmentChoice;
  locationAccess: LocationAccess;
  notificationAccess: NotificationAccess;
}

export const initialLeaderboardLocationEnrollmentState = {
  enrollment: "unprompted",
  locationAccess: "unknown",
  notificationAccess: "unknown",
} satisfies LeaderboardLocationEnrollmentState;

const enrollmentChoices: EnrollmentChoice[] = [
  "unprompted",
  "enrolled",
  "declined",
];
const locationAccesses: LocationAccess[] = [
  "unknown",
  "granted",
  "unavailable",
];
const notificationAccesses: NotificationAccess[] = [
  "unknown",
  "granted",
  "unavailable",
];

/** Safely reject stale or malformed local consent state. */
export const parseLeaderboardLocationEnrollmentState = (
  value: unknown
): LeaderboardLocationEnrollmentState => {
  if (!value || typeof value !== "object") {
    return initialLeaderboardLocationEnrollmentState;
  }

  const { enrollment, locationAccess, notificationAccess } =
    value as Partial<LeaderboardLocationEnrollmentState>;
  if (
    !enrollmentChoices.includes(enrollment as EnrollmentChoice) ||
    !locationAccesses.includes(locationAccess as LocationAccess) ||
    !notificationAccesses.includes(notificationAccess as NotificationAccess)
  ) {
    return initialLeaderboardLocationEnrollmentState;
  }

  return {
    enrollment: enrollment as EnrollmentChoice,
    locationAccess: locationAccess as LocationAccess,
    notificationAccess: notificationAccess as NotificationAccess,
  };
};

/** Notify the app-wide foreground watcher without retaining any location data. */
export const notifyLeaderboardEnrollmentChanged = (
  state: LeaderboardLocationEnrollmentState
): void => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<LeaderboardLocationEnrollmentState>(
        LEADERBOARD_LOCATION_ENROLLMENT_CHANGED,
        { detail: state }
      )
    );
  }
};

/**
 * Turns an authenticated profile name into a safe default leaderboard label.
 * Only initials are returned, so the caller never sends the full profile name
 * unless the user explicitly enters it as their chosen display name.
 */
export const leaderboardInitials = (profile?: {
  family_name?: string;
  given_name?: string;
  name?: string;
  nickname?: string;
}): string => {
  const name =
    [profile?.given_name, profile?.family_name].filter(Boolean).join(" ") ||
    profile?.name ||
    profile?.nickname ||
    "";
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || ""
  );
};

/**
 * Requests location only after an explicit user action and immediately drops
 * the returned coordinate.
 */
export const requestLeaderboardLocationAccess =
  async (): Promise<LocationAccess> => {
    const location = await requestCurrentLocation();
    return location ? "granted" : "unavailable";
  };

export const requestLeaderboardNotificationAccess =
  async (): Promise<NotificationAccess> =>
    (await requestNotificationPermission()) ? "granted" : "unavailable";
