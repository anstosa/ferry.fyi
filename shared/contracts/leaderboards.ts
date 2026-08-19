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

export const AUTOMATIC_CHECKIN_SCHEMA_VERSION = 1 as const;
export const AUTOMATIC_CHECKIN_CAPABILITY_VERSION = 1 as const;
export const AUTOMATIC_CHECKIN_MAX_BODY_BYTES = 4096;
export const AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS = 12 * 60 * 60 * 1000;

// define exact native credential scopes
export const AUTOMATIC_CHECKIN_NATIVE_SCOPES = [
  "automatic-checkins:config:read",
  "automatic-checkins:status:read",
  "automatic-checkins:candidates:write",
  "automatic-checkins:enrollment:revoke",
] as const;

// name one native credential scope
export type AutomaticCheckinNativeScope =
  (typeof AUTOMATIC_CHECKIN_NATIVE_SCOPES)[number];

// name one native enrollment platform
export type AutomaticEnrollmentPlatform = "android" | "ios";

/** inert native capability projection */
export interface AutomaticEnrollmentCapabilityV1 {
  androidSdkInt?: number;
  capabilityVersion: typeof AUTOMATIC_CHECKIN_CAPABILITY_VERSION;
  enabled: boolean;
  platform: AutomaticEnrollmentPlatform;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  supported: boolean;
}

/** strict authenticated enrollment request */
export interface AutomaticEnrollmentBootstrapRequestV1 {
  androidSdkInt?: number;
  capabilityVersion: typeof AUTOMATIC_CHECKIN_CAPABILITY_VERSION;
  installationNonce: string;
  platform: AutomaticEnrollmentPlatform;
  replacesEnrollmentId?: string;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
}

/** trusted native endpoint set */
export interface AutomaticNativeEndpointUrlsV1 {
  candidates: string;
  config: string;
  enrollment: string;
  status: string;
}

/** one-time enrollment credential response */
export interface AutomaticEnrollmentCredentialV1 {
  bearerToken: string;
  enrollmentId: string;
  expiresAtMs: number;
  rotateAfterMs: number;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  scopes: AutomaticCheckinNativeScope[];
  serverPolicyGeneration: number;
  urls: AutomaticNativeEndpointUrlsV1;
}

/** privacy-minimal managed device */
export interface AutomaticEnrollmentDeviceV1 {
  active: boolean;
  capabilityVersion: typeof AUTOMATIC_CHECKIN_CAPABILITY_VERSION;
  detectorEnabled: boolean;
  enrollmentId: string;
  expiresAtMs: number;
  health: "degraded" | "disabled" | "healthy" | "pending";
  platform: AutomaticEnrollmentPlatform;
  revokedAtMs: number | null;
}

/** managed device collection */
export interface AutomaticEnrollmentDevicesV1 {
  enrollments: AutomaticEnrollmentDeviceV1[];
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  serverPolicyGeneration: number;
}

/** fixed authenticated account-wide disable result */
export interface AutomaticEnrollmentDisableResultV1 {
  disabled: true;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  serverPolicyGeneration: number;
}

/** transient authenticated account-wide disable binding */
export interface AutomaticEnrollmentDisableRequestV1 {
  expectedSubject: string;
}

/** transient subject input for one device-only ownership proof */
export interface AutomaticEnrollmentIdentityRequestV1 {
  subject: string;
}

/** detail-free device-only ownership binding result */
export interface AutomaticEnrollmentIdentityBindingV1 {
  bound: boolean;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
}

/** detail-free device-only ownership check result */
export interface AutomaticEnrollmentIdentityCheckV1 {
  bound: boolean;
  matches: boolean;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
}

/** detail-free durable cleanup staging result */
export interface AutomaticEnrollmentCleanupStageV1 {
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  staged: boolean;
}

/** detail-free durable cleanup ownership check */
export interface AutomaticEnrollmentCleanupCheckV1 {
  matches: boolean;
  pending: boolean;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  valid: boolean;
}

/** detail-free durable cleanup clearing result */
export interface AutomaticEnrollmentCleanupClearV1 {
  cleared: boolean;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
}

/** strict detector health request */
export interface AutomaticEnrollmentHealthUpdateV1 {
  detectorEnabled: boolean;
  health: AutomaticEnrollmentDeviceV1["health"];
  installationNonce: string;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
}

/** fixed detector health response */
export interface AutomaticEnrollmentHealthResultV1 {
  enrollment: AutomaticEnrollmentDeviceV1;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  serverPolicyGeneration: number;
}

/** strict rotation lifecycle request */
export interface AutomaticEnrollmentRotationRequestV1 {
  installationNonce: string;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
}

/** fixed authenticated policy status */
export interface AutomaticNativePolicyStatusV1 {
  automaticEnabled: boolean;
  credentialExpiryBucket: AutomaticCheckinCredentialExpiryBucket;
  rotateRecommended: boolean;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  serverPolicyGeneration: number;
}

/** fixed authenticated revoke result */
export interface AutomaticNativeRevokeResultV1 {
  revoked: true;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  serverPolicyGeneration: number;
}

export const AUTOMATIC_CHECKIN_OUTCOMES = [
  "authentication_failed",
  "candidate_conflict",
  "credited",
  "detector_disabled",
  "enrollment_expired",
  "enrollment_revoked",
  "expired",
  "future_timestamp",
  "history_unavailable",
  "history_warming",
  "invalid_candidate",
  "location_accuracy_too_low",
  "malformed_payload",
  "outside_terminal",
  "payload_too_large",
  "policy_disabled",
  "rate_limited",
  "sailing_already_credited",
  "stale_event",
  "temporarily_unavailable",
  "terminal_config_unavailable",
  "terminal_not_found",
  "too_close_to_shore",
  "unsupported_encoding",
  "unsupported_media_type",
  "vessel_not_found",
] as const;

export type AutomaticCheckinOutcome =
  (typeof AUTOMATIC_CHECKIN_OUTCOMES)[number];

export const AUTOMATIC_CHECKIN_AGGREGATE_OUTCOMES = [
  ...AUTOMATIC_CHECKIN_OUTCOMES,
  "cleanup_required",
  "fleet_context_invalid",
  "unsupported_os",
] as const;

export type AutomaticCheckinAggregateOutcome =
  (typeof AUTOMATIC_CHECKIN_AGGREGATE_OUTCOMES)[number];

export const AUTOMATIC_CHECKIN_PERMISSION_HEALTH = [
  "authorized",
  "denied",
  "limited_accuracy",
  "not_determined",
  "restricted",
  "unsupported_os",
] as const;

export type AutomaticCheckinPermissionHealth =
  (typeof AUTOMATIC_CHECKIN_PERMISSION_HEALTH)[number];

export const AUTOMATIC_CHECKIN_MONITOR_HEALTH = [
  "background_refresh_off",
  "disabled",
  "first_unlock_required",
  "force_stopped",
  "geofence_unavailable",
  "healthy",
  "needs_config",
  "policy_disabled",
  "registration_failed",
  "stale_config",
  "stopped",
  "unavailable",
] as const;

export type AutomaticCheckinMonitorHealth =
  (typeof AUTOMATIC_CHECKIN_MONITOR_HEALTH)[number];

export const AUTOMATIC_CHECKIN_CREDENTIAL_EXPIRY_BUCKETS = [
  "expired",
  "less_than_1_day",
  "less_than_7_days",
  "seven_days_or_more",
  "unavailable",
] as const;

export type AutomaticCheckinCredentialExpiryBucket =
  (typeof AUTOMATIC_CHECKIN_CREDENTIAL_EXPIRY_BUCKETS)[number];

interface AutomaticCheckinCandidateBaseV1 {
  accuracyMillimeters: number;
  candidateId: string;
  capturedAtMs: number;
  latitudeE7: number;
  longitudeE7: number;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
}

export type AutomaticTerminalCheckinCandidateV1 =
  AutomaticCheckinCandidateBaseV1 & {
    configGeneration: number;
    kind: "terminal";
    terminalId: string;
  };

export type AutomaticVesselCheckinCandidateV1 =
  AutomaticCheckinCandidateBaseV1 & {
    kind: "vessel";
    sailingId: string;
    vesselId: string;
  };

export type AutomaticCheckinCandidateV1 =
  | AutomaticTerminalCheckinCandidateV1
  | AutomaticVesselCheckinCandidateV1;

export interface AutomaticCheckinResponseV1 {
  credited: boolean;
  disposition: "final" | "retryable";
  outcome: AutomaticCheckinOutcome;
  retryAfterSeconds?: number;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  serverPolicyGeneration: number | null;
}

export interface AutomaticEnrollmentStatusV1 {
  capabilityVersion: typeof AUTOMATIC_CHECKIN_CAPABILITY_VERSION;
  configGeneration: number | null;
  credentialExpiryBucket: AutomaticCheckinCredentialExpiryBucket;
  lastOutcome: AutomaticCheckinAggregateOutcome | null;
  monitorHealth: AutomaticCheckinMonitorHealth;
  pendingCandidateCount: number;
  permissionHealth: AutomaticCheckinPermissionHealth;
  platform: "android" | "ios";
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  serverPolicyGeneration: number;
}

/** detail-free result from one explicit enrollment permission action */
export interface AutomaticEnrollmentPermissionResultV1 {
  permissionHealth: AutomaticCheckinPermissionHealth;
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  settingsOpened: boolean;
}

/** detail-free result from one explicit native settings action */
export interface AutomaticEnrollmentSettingsResultV1 {
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  settingsOpened: boolean;
}

export interface AutomaticTerminalRegionV1 {
  configGeneration: number;
  latitudeE7: number;
  longitudeE7: number;
  radiusMillimeters: number;
  terminalId: string;
}

export interface AutomaticNativeConfigV1 {
  configGeneration: number;
  contentHash: string;
  detectors: {
    terminalEnabled: boolean;
    vesselEnabled: boolean;
  };
  generatedAtMs: number;
  parameters: {
    candidateRetentionMs: number;
    fleetContextMaxAgeMs: number;
    futureToleranceMs: number;
    maxLocationAccuracyMillimeters: number;
    maxPendingCandidates: number;
  };
  regions: AutomaticTerminalRegionV1[];
  schemaVersion: typeof AUTOMATIC_CHECKIN_SCHEMA_VERSION;
  serverPolicyGeneration: number;
  serverTimeMs: number;
  urls: AutomaticNativeEndpointUrlsV1;
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
   * user preference for an already healthy native enrollment
   * generic clients may disable but cannot enable without that enrollment
   */
  automaticCheckinsEnabled: boolean;
  /**
   * The user-controlled public label. This may be initials only; clients must
   * never derive it from, or submit, an account profile name without consent.
   */
  displayName: string;
  notificationsEnabled: boolean;
  optedOut: boolean;
  /** @deprecated Retained for wire compatibility; displayName is the chosen public label. */
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
