export type LeaderboardPeriod = "all" | "month" | "week";

export interface LeaderboardRank {
  label: string;
  rank: number;
  score: number;
}

export interface Leaderboard {
  entityId: string;
  period: LeaderboardPeriod;
  ranks: LeaderboardRank[];
}

/** Current participation state; no location or timing data is exposed. */
export interface LeaderboardCheckInStatus {
  checkedIn: boolean;
}

export interface ForegroundTerminalCheckInRequest {
  accuracyMeters: number;
  latitude: number;
  longitude: number;
  observedAt: string;
  terminalId: string;
}

export interface VesselCheckInRequest {
  accuracyMeters: number;
  latitude: number;
  longitude: number;
  observedAt: string;
  /** Server-derived from the currently live WSF sailing and echoed by the app. */
  sailingId: string;
  vesselId: string;
}

export interface VesselCheckInResult {
  credited: boolean;
  reason?:
    | "COASTLINE_COVERAGE_UNKNOWN"
    | "LOCATION_ACCURACY_TOO_LOW"
    | "NOT_NEAR_LIVE_VESSEL"
    | "SAILING_ALREADY_CREDITED"
    | "STALE_LOCATION"
    | "FUTURE_LOCATION"
    | "TOO_CLOSE_TO_SHORE"
    | "UNKNOWN_OR_UNSTABLE_SAILING";
  sailingId?: string;
}

export interface ForegroundTerminalPresenceResult {
  recorded: boolean;
  reason?:
    | "LOCATION_ACCURACY_TOO_LOW"
    | "LOCATION_UNCERTAIN"
    | "NOT_OUTSIDE_GEOFENCE"
    | "STALE_LOCATION"
    | "FUTURE_LOCATION"
    | "TERMINAL_NOT_FOUND";
}

export interface ForegroundTerminalCheckInResult {
  cooldownEndsAt?: string;
  credited: boolean;
  reason?:
    | "COOLDOWN"
    | "LOCATION_ACCURACY_TOO_LOW"
    | "MUST_LEAVE_TERMINAL"
    | "OUTSIDE_GEOFENCE"
    | "FUTURE_LOCATION"
    | "LOCATION_UNCERTAIN"
    | "STALE_LOCATION"
    | "TERMINAL_NOT_FOUND";
}

export interface LeaderboardPreferences {
  /**
   * Retained for wire compatibility with existing clients. The manual-only
   * launch always returns false and rejects attempts to set it true.
   */
  automaticCheckinsEnabled: boolean;
  /**
   * The user-controlled public label. This may be initials only; clients must
   * never derive it from, or submit, an account profile name without consent.
   */
  displayName: string;
  notificationsEnabled: boolean;
  optedOut: boolean;
  useFullName: boolean;
  verboseNotificationsEnabled: boolean;
}

/**
 * `initials` is an explicit privacy-preserving alternative to `displayName`.
 * It is stored as the leaderboard label and does not require a full name.
 */
export type LeaderboardPreferencesUpdate = Partial<LeaderboardPreferences> & {
  initials?: string;
};
