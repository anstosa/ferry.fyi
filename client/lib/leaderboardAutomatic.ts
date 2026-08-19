import type { PluginListenerHandle } from "@capacitor/core";
import {
  AUTOMATIC_CHECKIN_CAPABILITY_VERSION,
  AUTOMATIC_CHECKIN_PERMISSION_HEALTH,
  AUTOMATIC_CHECKIN_SCHEMA_VERSION,
  type AutomaticEnrollmentBootstrapRequestV1,
  type AutomaticEnrollmentCapabilityV1,
  type AutomaticEnrollmentCleanupCheckV1,
  type AutomaticEnrollmentCleanupClearV1,
  type AutomaticEnrollmentCleanupStageV1,
  type AutomaticEnrollmentCredentialV1,
  type AutomaticEnrollmentDisableResultV1,
  type AutomaticEnrollmentHealthResultV1,
  type AutomaticEnrollmentHealthUpdateV1,
  type AutomaticEnrollmentIdentityBindingV1,
  type AutomaticEnrollmentIdentityCheckV1,
  type AutomaticEnrollmentIdentityRequestV1,
  type AutomaticEnrollmentPermissionResultV1,
  type AutomaticEnrollmentPlatform,
  type AutomaticEnrollmentSettingsResultV1,
  type AutomaticEnrollmentStatusV1,
  type LeaderboardPreferences,
  type LeaderboardPreferencesUpdate,
} from "shared/contracts/leaderboards";
import { parseAutomaticEnrollmentStatusV1 } from "shared/lib/leaderboardAutomaticContracts";

export const AUTOMATIC_LEADERBOARD_CHANGED_EVENT =
  "leaderboard-checkins-changed";

// require the exact native bootstrap projection
const BOOTSTRAP_KEYS = [
  "androidSdkInt",
  "capabilityVersion",
  "enabled",
  "installationNonce",
  "manualFallbackAvailable",
  "platform",
  "schemaVersion",
  "supported",
] as const;
// require the exact native capability projection
const CAPABILITY_KEYS = [
  "androidSdkInt",
  "capabilityVersion",
  "enabled",
  "platform",
  "schemaVersion",
  "supported",
] as const;
// accept only canonical unpadded 256-bit values
const CANONICAL_32_BYTE_BASE64URL = /^[A-Za-z0-9_-]{42}[AQgw]$/;

export type AutomaticStopReason =
  | "account_deleted"
  | "enrollment_revoked"
  | "identity_lost"
  | "local_disable"
  | "profile_opted_out";

// name one fixed permission result promise
type AutomaticPermissionResultPromise =
  Promise<AutomaticEnrollmentPermissionResultV1>;

// define the exact native bootstrap bridge
export interface AutomaticEnrollmentBootstrapBridgeV1 {
  androidSdkInt?: number;
  capabilityVersion: 1;
  enabled: boolean;
  installationNonce?: string;
  manualFallbackAvailable: true;
  platform: AutomaticEnrollmentPlatform;
  schemaVersion: 1;
  supported: boolean;
}

// define the exact platform-neutral plugin bridge
export interface AutomaticLeaderboardCheckinsPluginV1 {
  addListener(
    eventName: typeof AUTOMATIC_LEADERBOARD_CHANGED_EVENT,
    listener: () => void
  ): Promise<PluginListenerHandle>;
  disableAndPurge(input: {
    reason: AutomaticStopReason;
  }): Promise<{ purged: boolean }>;
  bindIdentity(
    input: AutomaticEnrollmentIdentityRequestV1
  ): Promise<AutomaticEnrollmentIdentityBindingV1>;
  checkIdentity(
    input: AutomaticEnrollmentIdentityRequestV1
  ): Promise<AutomaticEnrollmentIdentityCheckV1>;
  checkEnrollmentCleanup(
    input: AutomaticEnrollmentIdentityRequestV1
  ): Promise<AutomaticEnrollmentCleanupCheckV1>;
  clearEnrollmentCleanup(
    input: AutomaticEnrollmentIdentityRequestV1
  ): Promise<AutomaticEnrollmentCleanupClearV1>;
  getCapability(): Promise<AutomaticEnrollmentCapabilityV1>;
  getEnrollmentBootstrap(): Promise<AutomaticEnrollmentBootstrapBridgeV1>;
  getStatus(): Promise<AutomaticEnrollmentStatusV1>;
  installCredential(
    credential: AutomaticEnrollmentCredentialV1
  ): Promise<{ installed: boolean }>;
  openAutomaticCheckinSettings(): Promise<AutomaticEnrollmentSettingsResultV1>;
  reconcile(): Promise<{ outcome: string }>;
  requestBackgroundLocationPermission(): AutomaticPermissionResultPromise;
  requestForegroundLocationPermission(): AutomaticPermissionResultPromise;
  stageEnrollmentCleanup(
    input: AutomaticEnrollmentIdentityRequestV1
  ): Promise<AutomaticEnrollmentCleanupStageV1>;
}

// define one completed enrollment projection
export interface AutomaticEnrollmentResult {
  preferencesEnabled: true;
  status: AutomaticEnrollmentStatusV1;
}

// bind one operation to its auth subject generation
export interface AutomaticEnrollmentOperation {
  readonly generation: number;
  readonly subject: string;
  readonly currentSubject: () => string | null;
}

// expose only aggregate rollback progress
export interface AutomaticEnrollmentCleanupState {
  cleanupProofCleared: boolean;
  enrollmentId: string | null;
  enrollmentRevoked: boolean;
  localPurged: boolean;
  preferenceDisabled: boolean;
  subjectVerified: boolean;
}

// identify one incomplete all-or-off rollback
export class AutomaticEnrollmentCleanupRequiredError extends Error {
  readonly cleanup: AutomaticEnrollmentCleanupState;

  // preserve fixed cleanup state without exposing the triggering detail
  constructor(cleanup: AutomaticEnrollmentCleanupState) {
    super("automatic enrollment cleanup_required");
    this.name = "AutomaticEnrollmentCleanupRequiredError";
    this.cleanup = cleanup;
  }
}

// identify one cleanup attempt without durable recovery ownership
export class AutomaticEnrollmentCleanupDurabilityError extends Error {
  readonly localPurged: boolean;

  // preserve only the aggregate local purge result
  constructor(localPurged: boolean) {
    super("automatic enrollment cleanup durability unavailable");
    this.name = "AutomaticEnrollmentCleanupDurabilityError";
    this.localPurged = localPurged;
  }
}

// identify one cancelled stale client operation
export class AutomaticEnrollmentOperationCancelledError extends Error {
  // define the fixed cancellation error
  constructor() {
    super("automatic enrollment operation cancelled");
    this.name = "AutomaticEnrollmentOperationCancelledError";
  }
}

// isolate enrollment side effects for deterministic tests
interface AutomaticEnrollmentDependencies {
  createEnrollment: (
    request: AutomaticEnrollmentBootstrapRequestV1,
    accessToken: string
  ) => Promise<AutomaticEnrollmentCredentialV1>;
  disableEnrollments: (
    accessToken: string,
    expectedSubject: string
  ) => Promise<unknown>;
  pause: (milliseconds: number) => Promise<void>;
  updateHealth: (
    enrollmentId: string,
    health: AutomaticEnrollmentHealthUpdateV1,
    accessToken: string
  ) => Promise<AutomaticEnrollmentHealthResultV1>;
  updatePreferences: (
    preferences: LeaderboardPreferencesUpdate,
    accessToken: string
  ) => Promise<LeaderboardPreferences>;
}

const defaultDependencies: AutomaticEnrollmentDependencies = {
  // defer api binding for manual-only client surfaces
  createEnrollment: async (request, accessToken) =>
    await import("~/lib/leaderboards").then(({ createAutomaticEnrollment }) =>
      createAutomaticEnrollment(request, accessToken)
    ),
  // defer the ungated account disable api binding
  disableEnrollments: async (accessToken, expectedSubject) =>
    await import("~/lib/leaderboards").then(({ disableAutomaticEnrollments }) =>
      disableAutomaticEnrollments(accessToken, expectedSubject)
    ),
  // wait between aggregate status reads
  pause: async (milliseconds) =>
    await new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
  // defer api binding for manual-only client surfaces
  updateHealth: async (enrollmentId, health, accessToken) =>
    await import("~/lib/leaderboards").then(
      ({ updateAutomaticEnrollmentHealth }) =>
        updateAutomaticEnrollmentHealth(enrollmentId, health, accessToken)
    ),
  // defer api binding for manual-only client surfaces
  updatePreferences: async (preferences, accessToken) =>
    await import("~/lib/leaderboards").then(
      ({ updateLeaderboardPreferences }) =>
        updateLeaderboardPreferences(preferences, accessToken)
    ),
};

let automaticEnrollmentGeneration = 0;
let automaticEnrollmentCoordinatorTail: Promise<void> = Promise.resolve();
let automaticEnrollmentTeardownCount = 0;

// serialize enrollment and teardown effects in one browser process
const withAutomaticEnrollmentCoordinator = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  const previous = automaticEnrollmentCoordinatorTail;
  let release = (): void => undefined;
  automaticEnrollmentCoordinatorTail = new Promise<void>(
    // retain one serialized release boundary
    (resolve) => {
      release = resolve;
    }
  );
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
};

// serialize one teardown while rejecting new enrollment ownership
const withAutomaticEnrollmentTeardown = async <T>(
  operation: () => Promise<T>
): Promise<T> => {
  automaticEnrollmentTeardownCount += 1;
  invalidateAutomaticEnrollmentOperations();
  try {
    return await withAutomaticEnrollmentCoordinator(operation);
  } finally {
    automaticEnrollmentTeardownCount -= 1;
  }
};

// begin one subject-bound enrollment attempt
export const beginAutomaticEnrollmentOperation = (
  subject: string,
  currentSubject: () => string | null
): AutomaticEnrollmentOperation => {
  // reject anonymous enrollment ownership
  if (!subject || automaticEnrollmentTeardownCount > 0) {
    throw new AutomaticEnrollmentOperationCancelledError();
  }
  automaticEnrollmentGeneration += 1;
  return { currentSubject, generation: automaticEnrollmentGeneration, subject };
};

// cancel one exact mounted enrollment attempt
export const cancelAutomaticEnrollmentOperation = (
  operation: AutomaticEnrollmentOperation
): void => {
  // invalidate only the currently active operation
  if (operation.generation === automaticEnrollmentGeneration) {
    automaticEnrollmentGeneration += 1;
  }
};

// invalidate every stale enrollment before identity teardown
export const invalidateAutomaticEnrollmentOperations = (): void => {
  automaticEnrollmentGeneration += 1;
};

// enforce the current mounted auth identity
export const assertAutomaticEnrollmentOperation = (
  operation: AutomaticEnrollmentOperation
): void => {
  // reject generation and subject changes
  if (
    operation.generation !== automaticEnrollmentGeneration ||
    operation.currentSubject() !== operation.subject
  ) {
    throw new AutomaticEnrollmentOperationCancelledError();
  }
};

// execute one identity-checked asynchronous enrollment phase
const runAutomaticEnrollmentPhase = async <T>(
  operation: AutomaticEnrollmentOperation,
  phase: () => Promise<T>
): Promise<T> => {
  assertAutomaticEnrollmentOperation(operation);
  const result = await phase();
  assertAutomaticEnrollmentOperation(operation);
  return result;
};

// compare one exact string-key set
const hasExactKeys = (
  value: Record<string, unknown>,
  keys: readonly string[]
) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  // reject missing and extra bridge fields
  if (actual.length !== expected.length) {
    return false;
  }
  return actual.every((key, index) => key === expected[index]);
};

// validate one safe integer
const isSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

// validate one exact authenticated disable acknowledgement
const parseAutomaticEnrollmentDisableResult = (
  value: unknown
): AutomaticEnrollmentDisableResultV1 | null => {
  // require the exact fixed projection
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, [
      "disabled",
      "schemaVersion",
      "serverPolicyGeneration",
    ])
  ) {
    return null;
  }
  const result = value as Record<string, unknown>;
  // validate every fixed value
  if (
    result.disabled !== true ||
    result.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION ||
    !isSafeInteger(result.serverPolicyGeneration)
  ) {
    return null;
  }
  return result as unknown as AutomaticEnrollmentDisableResultV1;
};

// validate one exact device-only ownership binding result
const parseAutomaticEnrollmentIdentityBinding = (
  value: unknown
): AutomaticEnrollmentIdentityBindingV1 | null => {
  // require the exact fixed projection
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, ["bound", "schemaVersion"])
  ) {
    return null;
  }
  const result = value as Record<string, unknown>;
  // validate every fixed field
  if (
    typeof result.bound !== "boolean" ||
    result.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION
  ) {
    return null;
  }
  return result as unknown as AutomaticEnrollmentIdentityBindingV1;
};

// validate one exact device-only ownership check result
const parseAutomaticEnrollmentIdentityCheck = (
  value: unknown
): AutomaticEnrollmentIdentityCheckV1 | null => {
  // require the exact fixed projection
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, [
      "bound",
      "matches",
      "schemaVersion",
    ])
  ) {
    return null;
  }
  const result = value as Record<string, unknown>;
  // validate every fixed field and relation
  if (
    typeof result.bound !== "boolean" ||
    typeof result.matches !== "boolean" ||
    (result.matches && !result.bound) ||
    result.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION
  ) {
    return null;
  }
  return result as unknown as AutomaticEnrollmentIdentityCheckV1;
};

// validate one exact cleanup staging result
const parseAutomaticEnrollmentCleanupStage = (
  value: unknown
): AutomaticEnrollmentCleanupStageV1 | null => {
  // require the exact fixed projection
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, ["schemaVersion", "staged"])
  ) {
    return null;
  }
  const result = value as Record<string, unknown>;
  // validate every fixed field
  if (
    typeof result.staged !== "boolean" ||
    result.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION
  ) {
    return null;
  }
  return result as unknown as AutomaticEnrollmentCleanupStageV1;
};

// validate one exact cleanup ownership result
const parseAutomaticEnrollmentCleanupCheck = (
  value: unknown
): AutomaticEnrollmentCleanupCheckV1 | null => {
  // require the exact fixed projection
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, [
      "matches",
      "pending",
      "schemaVersion",
      "valid",
    ])
  ) {
    return null;
  }
  const result = value as Record<string, unknown>;
  // validate every field and relation
  if (
    typeof result.matches !== "boolean" ||
    typeof result.pending !== "boolean" ||
    typeof result.valid !== "boolean" ||
    (result.matches && (!result.pending || !result.valid)) ||
    (!result.pending && (!result.valid || result.matches)) ||
    result.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION
  ) {
    return null;
  }
  return result as unknown as AutomaticEnrollmentCleanupCheckV1;
};

// validate one exact cleanup clearing result
const parseAutomaticEnrollmentCleanupClear = (
  value: unknown
): AutomaticEnrollmentCleanupClearV1 | null => {
  // require the exact fixed projection
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, [
      "cleared",
      "schemaVersion",
    ])
  ) {
    return null;
  }
  const result = value as Record<string, unknown>;
  // validate every fixed field
  if (
    typeof result.cleared !== "boolean" ||
    result.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION
  ) {
    return null;
  }
  return result as unknown as AutomaticEnrollmentCleanupClearV1;
};

// validate one exact native bootstrap projection
export const parseAutomaticEnrollmentBootstrap = (
  value: unknown
): AutomaticEnrollmentBootstrapBridgeV1 | null => {
  // require an object projection
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const { platform } = record;
  const keys =
    platform === "android"
      ? BOOTSTRAP_KEYS
      : BOOTSTRAP_KEYS.filter((key) => key !== "androidSdkInt");
  // require the exact platform shape
  if (
    !hasExactKeys(record, keys) ||
    record.capabilityVersion !== AUTOMATIC_CHECKIN_CAPABILITY_VERSION ||
    record.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION ||
    (platform !== "android" && platform !== "ios") ||
    typeof record.enabled !== "boolean" ||
    typeof record.supported !== "boolean" ||
    record.manualFallbackAvailable !== true ||
    (platform === "android" && !isSafeInteger(record.androidSdkInt)) ||
    (platform === "android" &&
      record.supported !== (record.androidSdkInt as number) >= 29) ||
    (record.enabled === true && record.supported !== true) ||
    (record.enabled === true && record.installationNonce === undefined) ||
    (record.enabled === false && record.installationNonce !== undefined) ||
    (record.installationNonce !== undefined &&
      (typeof record.installationNonce !== "string" ||
        !CANONICAL_32_BYTE_BASE64URL.test(record.installationNonce)))
  ) {
    return null;
  }
  return record as unknown as AutomaticEnrollmentBootstrapBridgeV1;
};

// reuse the canonical strict aggregate parser
export const parseAutomaticEnrollmentStatus = parseAutomaticEnrollmentStatusV1;

// validate one inert native capability projection
export const parseAutomaticEnrollmentCapability = (
  value: unknown
): AutomaticEnrollmentCapabilityV1 | null => {
  // require an object projection
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const keys =
    record.platform === "android"
      ? CAPABILITY_KEYS
      : CAPABILITY_KEYS.filter((key) => key !== "androidSdkInt");
  // require the exact platform capability shape
  if (
    !hasExactKeys(record, keys) ||
    record.capabilityVersion !== AUTOMATIC_CHECKIN_CAPABILITY_VERSION ||
    record.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION ||
    (record.platform !== "android" && record.platform !== "ios") ||
    typeof record.enabled !== "boolean" ||
    typeof record.supported !== "boolean" ||
    (record.platform === "android" && !isSafeInteger(record.androidSdkInt)) ||
    (record.platform === "android" &&
      record.supported !== (record.androidSdkInt as number) >= 29) ||
    (record.enabled === true && record.supported !== true)
  ) {
    return null;
  }
  return record as unknown as AutomaticEnrollmentCapabilityV1;
};

// require every native health gate
export const isAutomaticEnrollmentHealthy = (
  status: AutomaticEnrollmentStatusV1
): boolean =>
  status.permissionHealth === "authorized" &&
  status.monitorHealth === "healthy" &&
  status.configGeneration !== null &&
  status.credentialExpiryBucket !== "expired" &&
  status.credentialExpiryBucket !== "unavailable";

// validate one exact detail-free permission result
const parseAutomaticPermissionResult = (
  value: unknown
): AutomaticEnrollmentPermissionResultV1 | null => {
  // require the exact fixed projection
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, [
      "permissionHealth",
      "schemaVersion",
      "settingsOpened",
    ])
  ) {
    return null;
  }
  const result = value as Record<string, unknown>;
  // validate every fixed value
  if (
    result.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION ||
    typeof result.settingsOpened !== "boolean" ||
    !AUTOMATIC_CHECKIN_PERMISSION_HEALTH.includes(
      result.permissionHealth as never
    )
  ) {
    return null;
  }
  return result as unknown as AutomaticEnrollmentPermissionResultV1;
};

// validate one exact detail-free settings result
const parseAutomaticSettingsResult = (
  value: unknown
): AutomaticEnrollmentSettingsResultV1 | null => {
  // require one fixed settings projection
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hasExactKeys(value as Record<string, unknown>, [
      "schemaVersion",
      "settingsOpened",
    ])
  ) {
    return null;
  }
  const result = value as Record<string, unknown>;
  // validate every fixed value
  if (
    result.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION ||
    typeof result.settingsOpened !== "boolean"
  ) {
    return null;
  }
  return result as unknown as AutomaticEnrollmentSettingsResultV1;
};

// open the reviewed native application-settings boundary
export const openAutomaticEnrollmentSettings = async (
  plugin: AutomaticLeaderboardCheckinsPluginV1
): Promise<AutomaticEnrollmentSettingsResultV1> => {
  const result = parseAutomaticSettingsResult(
    await plugin.openAutomaticCheckinSettings()
  );
  // fail closed on malformed native settings output
  if (!result) {
    throw new Error("automatic settings result was invalid");
  }
  return result;
};

// execute the reviewed foreground-then-background permission sequence
export const requestAutomaticEnrollmentPermissions = async (
  plugin: AutomaticLeaderboardCheckinsPluginV1
): Promise<AutomaticEnrollmentPermissionResultV1> => {
  const foreground = parseAutomaticPermissionResult(
    await plugin.requestForegroundLocationPermission()
  );
  // reject malformed foreground authority without inventing health
  if (!foreground) {
    throw new Error("automatic native permission status unavailable");
  }
  // require precise foreground permission before the background action
  if (foreground.permissionHealth !== "authorized") {
    return foreground;
  }
  const background = parseAutomaticPermissionResult(
    await plugin.requestBackgroundLocationPermission()
  );
  // fail closed on a malformed native result
  if (!background) {
    throw new Error("automatic native permission status unavailable");
  }
  return background;
};

// resolve the app-local native bridge only on native platforms
export const getAutomaticLeaderboardPlugin =
  async (): Promise<AutomaticLeaderboardCheckinsPluginV1 | null> => {
    // keep web and ssr bundles free of bridge work
    if (
      typeof window === "undefined" ||
      !(
        window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }
      ).Capacitor?.isNativePlatform?.()
    ) {
      return null;
    }
    const { registerPlugin } = await import("@capacitor/core");
    return registerPlugin<AutomaticLeaderboardCheckinsPluginV1>(
      "AutomaticLeaderboardCheckins"
    );
  };

// read one validated aggregate status
export const getAutomaticEnrollmentStatus = async (
  plugin?: AutomaticLeaderboardCheckinsPluginV1 | null
): Promise<AutomaticEnrollmentStatusV1 | null> => {
  const bridge = plugin ?? (await getAutomaticLeaderboardPlugin());
  // preserve manual fallback outside native apps
  if (!bridge) {
    return null;
  }
  return parseAutomaticEnrollmentStatus(await bridge.getStatus());
};

// read one validated inert native capability
export const getAutomaticEnrollmentCapability = async (
  plugin?: AutomaticLeaderboardCheckinsPluginV1 | null
): Promise<AutomaticEnrollmentCapabilityV1 | null> => {
  const bridge = plugin ?? (await getAutomaticLeaderboardPlugin());
  // preserve manual-only web behavior
  if (!bridge) {
    return null;
  }
  return parseAutomaticEnrollmentCapability(await bridge.getCapability());
};

// bind one installed credential to a device-only subject proof
export const bindAutomaticEnrollmentIdentity = async (
  subject: string,
  plugin: AutomaticLeaderboardCheckinsPluginV1
): Promise<void> => {
  // reject an unusable transient subject before the bridge
  if (!subject || subject.length > 512) {
    throw new Error("automatic identity owner unavailable");
  }
  const result = parseAutomaticEnrollmentIdentityBinding(
    await plugin.bindIdentity({ subject })
  );
  // require durable native ownership before reconciliation
  if (!result?.bound) {
    throw new Error("automatic identity binding failed");
  }
};

// check one device-only subject proof without exposing its digest
export const checkAutomaticEnrollmentIdentity = async (
  subject: string,
  plugin: AutomaticLeaderboardCheckinsPluginV1
): Promise<AutomaticEnrollmentIdentityCheckV1> => {
  // reject an unusable transient subject before the bridge
  if (!subject || subject.length > 512) {
    throw new Error("automatic identity owner unavailable");
  }
  const result = parseAutomaticEnrollmentIdentityCheck(
    await plugin.checkIdentity({ subject })
  );
  // fail closed on malformed or unavailable native proof
  if (!result) {
    throw new Error("automatic identity proof unavailable");
  }
  return result;
};

// stage one subject-bound durable cleanup marker
export const stageAutomaticEnrollmentCleanup = async (
  subject: string,
  plugin: AutomaticLeaderboardCheckinsPluginV1
): Promise<boolean> => {
  // reject an unusable transient subject before the bridge
  if (!subject || subject.length > 512) {
    throw new Error("automatic cleanup owner unavailable");
  }
  const result = parseAutomaticEnrollmentCleanupStage(
    await plugin.stageEnrollmentCleanup({ subject })
  );
  return result?.staged === true;
};

// check one durable cleanup marker without exposing its owner proof
export const checkAutomaticEnrollmentCleanup = async (
  subject: string,
  plugin: AutomaticLeaderboardCheckinsPluginV1
): Promise<AutomaticEnrollmentCleanupCheckV1> => {
  // reject an unusable transient subject before the bridge
  if (!subject || subject.length > 512) {
    throw new Error("automatic cleanup owner unavailable");
  }
  const result = parseAutomaticEnrollmentCleanupCheck(
    await plugin.checkEnrollmentCleanup({ subject })
  );
  // fail closed on malformed or unavailable native proof
  if (!result) {
    throw new Error("automatic cleanup proof unavailable");
  }
  return result;
};

// clear only one exactly matched durable cleanup marker
export const clearAutomaticEnrollmentCleanup = async (
  subject: string,
  plugin: AutomaticLeaderboardCheckinsPluginV1
): Promise<boolean> => {
  // reject an unusable transient subject before the bridge
  if (!subject || subject.length > 512) {
    throw new Error("automatic cleanup owner unavailable");
  }
  const result = parseAutomaticEnrollmentCleanupClear(
    await plugin.clearEnrollmentCleanup({ subject })
  );
  return result?.cleared === true;
};

// wait for the durable native reconciliation result
const waitForHealthyStatus = async (
  plugin: AutomaticLeaderboardCheckinsPluginV1,
  dependencies: AutomaticEnrollmentDependencies,
  operation: AutomaticEnrollmentOperation
): Promise<AutomaticEnrollmentStatusV1> => {
  let lastStatus: AutomaticEnrollmentStatusV1 | null = null;
  // poll only a bounded foreground window
  for (let attempt = 0; attempt < 8; attempt += 1) {
    lastStatus = parseAutomaticEnrollmentStatus(
      await runAutomaticEnrollmentPhase(
        operation,
        async () => await plugin.getStatus()
      )
    );
    // stop once every native gate is healthy
    if (lastStatus && isAutomaticEnrollmentHealthy(lastStatus)) {
      return lastStatus;
    }
    // wait only between remaining reads
    if (attempt < 7) {
      await runAutomaticEnrollmentPhase(
        operation,
        async () => await dependencies.pause(500)
      );
    }
  }
  throw new Error(
    lastStatus
      ? `automatic enrollment unhealthy:${lastStatus.permissionHealth}:${lastStatus.monitorHealth}`
      : "automatic enrollment returned an invalid status"
  );
};

// converge one failed attempt without swallowing cleanup failures
const rollbackEnrollment = async (
  plugin: AutomaticLeaderboardCheckinsPluginV1,
  subject: string,
  enrollmentId: string | null,
  accessToken: string | (() => Promise<string>),
  dependencies: AutomaticEnrollmentDependencies,
  existing?: AutomaticEnrollmentCleanupState,
  currentSubject: () => string | null = () => subject
): Promise<AutomaticEnrollmentCleanupState> => {
  // persist cleanup ownership before any identity-ending local purge
  const cleanupStaged = await stageAutomaticEnrollmentCleanup(
    subject,
    plugin
  ).catch(
    // preserve one failed durable marker boundary
    () => false
  );
  // stop and purge device-only material first
  const localPurged =
    existing?.localPurged === true ||
    (await plugin
      .disableAndPurge({ reason: "local_disable" })
      .then(
        // project one detail-free purge result
        (result) => result.purged === true
      )
      .catch(
        // preserve one failed local boundary
        () => false
      ));
  // never start a recoverable server transaction without durable ownership
  if (!cleanupStaged) {
    throw new AutomaticEnrollmentCleanupDurabilityError(localPurged);
  }
  // require local purge convergence before authenticated cleanup
  if (!localPurged) {
    throw new AutomaticEnrollmentCleanupRequiredError({
      cleanupProofCleared: false,
      enrollmentId,
      enrollmentRevoked: existing?.enrollmentRevoked === true,
      localPurged: false,
      preferenceDisabled: existing?.preferenceDisabled === true,
      subjectVerified: true,
    });
  }
  // retain the exact marker when identity changes before server cleanup
  if (currentSubject() !== subject) {
    throw new AutomaticEnrollmentCleanupRequiredError({
      cleanupProofCleared: false,
      enrollmentId,
      enrollmentRevoked: existing?.enrollmentRevoked === true,
      localPurged,
      preferenceDisabled: existing?.preferenceDisabled === true,
      subjectVerified: true,
    });
  }
  let serverCleanupConfirmed =
    existing?.preferenceDisabled === true &&
    existing.enrollmentRevoked === true;
  // acquire authenticated authority only after local purge converges
  if (!serverCleanupConfirmed) {
    const cleanupAccessToken =
      typeof accessToken === "string" ? accessToken : await accessToken();
    // retain the exact marker when identity changes during token acquisition
    if (currentSubject() !== subject) {
      throw new AutomaticEnrollmentCleanupRequiredError({
        cleanupProofCleared: false,
        enrollmentId,
        enrollmentRevoked: false,
        localPurged,
        preferenceDisabled: false,
        subjectVerified: true,
      });
    }
    serverCleanupConfirmed = await dependencies
      .disableEnrollments(cleanupAccessToken, subject)
      .then(
        // require one exact server acknowledgement
        (value) => parseAutomaticEnrollmentDisableResult(value) !== null
      )
      .catch(
        // preserve one unconfirmed server boundary
        () => false
      );
  }
  // retain the exact marker when identity changes before local clear
  if (currentSubject() !== subject) {
    throw new AutomaticEnrollmentCleanupRequiredError({
      cleanupProofCleared: false,
      enrollmentId,
      enrollmentRevoked: serverCleanupConfirmed,
      localPurged,
      preferenceDisabled: serverCleanupConfirmed,
      subjectVerified: true,
    });
  }
  const cleanupProofCleared =
    cleanupStaged &&
    localPurged &&
    serverCleanupConfirmed &&
    (await clearAutomaticEnrollmentCleanup(subject, plugin).catch(
      // preserve one failed proof-clear boundary
      () => false
    ));
  return {
    cleanupProofCleared,
    enrollmentId,
    enrollmentRevoked: serverCleanupConfirmed,
    localPurged,
    preferenceDisabled: serverCleanupConfirmed,
    subjectVerified: true,
  };
};

// require every rollback boundary to confirm safe convergence
const requireCompleteRollback = (
  cleanup: AutomaticEnrollmentCleanupState
): void => {
  // surface any unconfirmed cleanup step
  if (
    !cleanup.cleanupProofCleared ||
    !cleanup.localPurged ||
    !cleanup.preferenceDisabled ||
    !cleanup.enrollmentRevoked
  ) {
    throw new AutomaticEnrollmentCleanupRequiredError(cleanup);
  }
};

// create and install one credential within the narrowest javascript scope
const installCreatedAutomaticCredential = async (
  request: AutomaticEnrollmentBootstrapRequestV1,
  accessToken: string,
  plugin: AutomaticLeaderboardCheckinsPluginV1,
  operation: AutomaticEnrollmentOperation,
  dependencies: AutomaticEnrollmentDependencies,
  onCreated: (enrollmentId: string) => void
): Promise<string> => {
  const credential = await runAutomaticEnrollmentPhase(
    operation,
    // request one server credential only after native bootstrap
    async () => await dependencies.createEnrollment(request, accessToken)
  );
  onCreated(credential.enrollmentId);
  const installed = await runAutomaticEnrollmentPhase(
    operation,
    // transfer the credential directly into device-only storage
    async () => await plugin.installCredential(credential)
  );
  // require durable native credential installation
  if (installed.installed !== true) {
    throw new Error("automatic credential installation failed");
  }
  await runAutomaticEnrollmentPhase(
    operation,
    // bind the installed credential before any native health claim
    async () => await bindAutomaticEnrollmentIdentity(operation.subject, plugin)
  );
  return credential.enrollmentId;
};

// complete the explicit all-or-off enrollment transaction
export const enrollAutomaticLeaderboardCheckins = async (
  accessToken: string,
  plugin: AutomaticLeaderboardCheckinsPluginV1,
  operation: AutomaticEnrollmentOperation,
  overrides: Partial<AutomaticEnrollmentDependencies> = {}
): Promise<AutomaticEnrollmentResult> =>
  await withAutomaticEnrollmentCoordinator(async () => {
    const dependencies = { ...defaultDependencies, ...overrides };
    let enrollmentId: string | null = null;
    try {
      const bootstrap = parseAutomaticEnrollmentBootstrap(
        await runAutomaticEnrollmentPhase(
          operation,
          async () => await plugin.getEnrollmentBootstrap()
        )
      );
      // require one explicitly enabled native capability
      if (
        !bootstrap?.enabled ||
        !bootstrap.supported ||
        !bootstrap.installationNonce
      ) {
        throw new Error("automatic enrollment is unavailable on this build");
      }
      const { installationNonce } = bootstrap;
      const request: AutomaticEnrollmentBootstrapRequestV1 = {
        ...(bootstrap.platform === "android"
          ? { androidSdkInt: bootstrap.androidSdkInt }
          : {}),
        capabilityVersion: bootstrap.capabilityVersion,
        installationNonce,
        platform: bootstrap.platform,
        schemaVersion: bootstrap.schemaVersion,
      };
      const createdEnrollmentId = await installCreatedAutomaticCredential(
        request,
        accessToken,
        plugin,
        operation,
        dependencies,
        // preserve the partial enrollment id for fail-closed rollback
        (createdId) => {
          enrollmentId = createdId;
        }
      );
      await runAutomaticEnrollmentPhase(
        operation,
        async () => await plugin.reconcile()
      );
      const status = await waitForHealthyStatus(
        plugin,
        dependencies,
        operation
      );
      await runAutomaticEnrollmentPhase(
        operation,
        async () =>
          await dependencies.updateHealth(
            createdEnrollmentId,
            {
              detectorEnabled: true,
              health: "healthy",
              installationNonce,
              schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
            },
            accessToken
          )
      );
      const preferences = await runAutomaticEnrollmentPhase(
        operation,
        async () =>
          await dependencies.updatePreferences(
            { automaticCheckinsEnabled: true, optedOut: false },
            accessToken
          )
      );
      // require the server preference to reflect completed native health
      if (!preferences.automaticCheckinsEnabled || preferences.optedOut) {
        throw new Error("automatic preference activation failed");
      }
      return { preferencesEnabled: true, status };
    } catch (error) {
      const cleanup = await rollbackEnrollment(
        plugin,
        operation.subject,
        enrollmentId,
        accessToken,
        dependencies,
        undefined,
        operation.currentSubject
      );
      requireCompleteRollback(cleanup);
      throw error;
    }
  });

// retry one exact incomplete enrollment rollback
export const retryAutomaticEnrollmentCleanup = async (
  cleanup: AutomaticEnrollmentCleanupState,
  subject: string,
  accessToken: string | (() => Promise<string>),
  plugin: AutomaticLeaderboardCheckinsPluginV1,
  overrides: Partial<AutomaticEnrollmentDependencies> = {},
  currentSubject: () => string | null = () => subject
): Promise<void> => {
  // never authorize server cleanup for an unverified durable owner
  if (!cleanup.subjectVerified) {
    throw new AutomaticEnrollmentCleanupRequiredError(cleanup);
  }
  await withAutomaticEnrollmentTeardown(async () => {
    const proof = await checkAutomaticEnrollmentCleanup(subject, plugin).catch(
      () => null
    );
    // revalidate the exact durable owner before account-wide cleanup
    if (!proof?.pending || !proof.valid || !proof.matches) {
      throw new AutomaticEnrollmentCleanupRequiredError({
        ...cleanup,
        subjectVerified: false,
      });
    }
    const result = await rollbackEnrollment(
      plugin,
      subject,
      cleanup.enrollmentId,
      accessToken,
      { ...defaultDependencies, ...overrides },
      cleanup,
      currentSubject
    );
    requireCompleteRollback(result);
  });
};

// identify one structured incomplete cleanup result
export const isAutomaticEnrollmentCleanupRequiredError = (
  error: unknown
): error is AutomaticEnrollmentCleanupRequiredError =>
  error instanceof AutomaticEnrollmentCleanupRequiredError;

// identify one cleanup attempt whose durable marker could not be staged
export const isAutomaticEnrollmentCleanupDurabilityError = (
  error: unknown
): error is AutomaticEnrollmentCleanupDurabilityError =>
  error instanceof AutomaticEnrollmentCleanupDurabilityError;

// purge local automatic material before controllable identity teardown
export const disableAutomaticLeaderboardCheckins = async (
  reason: AutomaticStopReason,
  plugin?: AutomaticLeaderboardCheckinsPluginV1 | null
): Promise<void> => {
  await withAutomaticEnrollmentTeardown(async () => {
    const bridge = plugin ?? (await getAutomaticLeaderboardPlugin());
    // keep web identity teardown unchanged
    if (!bridge) {
      return;
    }
    const result = await bridge.disableAndPurge({ reason });
    // block auth teardown until local purge converges
    if (result.purged !== true) {
      throw new Error("automatic check-in data could not be purged");
    }
  });
};

// confirm local purge and authenticated server revocation before teardown
export const disableAutomaticLeaderboardAccount = async (
  reason: AutomaticStopReason,
  subject: string,
  currentSubject: () => string | null,
  getAccessToken: () => Promise<string>,
  plugin?: AutomaticLeaderboardCheckinsPluginV1 | null,
  overrides: Pick<AutomaticEnrollmentDependencies, "disableEnrollments"> = {
    disableEnrollments: defaultDependencies.disableEnrollments,
  }
): Promise<void> => {
  // require one bounded authenticated cleanup owner
  if (!subject || subject.length > 512) {
    throw new Error("automatic cleanup owner unavailable");
  }
  await withAutomaticEnrollmentTeardown(async () => {
    // reject a stale authenticated owner before native mutation
    if (currentSubject() !== subject) {
      throw new Error("automatic cleanup owner changed");
    }
    const bridge = plugin ?? (await getAutomaticLeaderboardPlugin());
    let localPurged = true;
    let cleanupProofStaged = false;
    // stage durable ownership before purging device-only material
    if (bridge) {
      const capability = await getAutomaticEnrollmentCapability(bridge).catch(
        // fail closed when native capability cannot be verified
        () => null
      );
      const automaticRuntimeInert =
        capability !== null && (!capability.enabled || !capability.supported);
      // stage only when this build can own automatic runtime material
      if (!automaticRuntimeInert) {
        cleanupProofStaged = await stageAutomaticEnrollmentCleanup(
          subject,
          bridge
        ).catch(
          // preserve one failed durable marker boundary
          () => false
        );
      }
      localPurged = await bridge
        .disableAndPurge({ reason })
        .then(
          // project one detail-free purge result
          (local) => local.purged === true
        )
        .catch(
          // preserve one failed local boundary
          () => false
        );
      // distinguish unrecoverable marker failure after the safest local stop
      if (!automaticRuntimeInert && !cleanupProofStaged) {
        throw new AutomaticEnrollmentCleanupDurabilityError(localPurged);
      }
      // require durable local cleanup first
      if (!localPurged) {
        throw new AutomaticEnrollmentCleanupRequiredError({
          cleanupProofCleared: false,
          enrollmentId: null,
          enrollmentRevoked: false,
          localPurged: false,
          preferenceDisabled: false,
          subjectVerified: true,
        });
      }
    }
    // retain the marker when identity changes after local purge
    if (currentSubject() !== subject) {
      throw new Error("automatic cleanup owner changed");
    }
    const accessToken = await getAccessToken();
    // retain the marker when identity changes during token acquisition
    if (currentSubject() !== subject) {
      throw new Error("automatic cleanup owner changed");
    }
    const disabled = parseAutomaticEnrollmentDisableResult(
      await overrides.disableEnrollments(accessToken, subject)
    );
    // require the authenticated revocation transaction to commit
    if (!disabled) {
      throw new Error("automatic enrollment revocation was not confirmed");
    }
    // retain the exact marker when identity changes before local clear
    if (currentSubject() !== subject) {
      throw new Error("automatic cleanup owner changed");
    }
    // clear only after exact server acknowledgement and local convergence
    if (
      bridge &&
      cleanupProofStaged &&
      !(await clearAutomaticEnrollmentCleanup(subject, bridge).catch(
        // preserve one failed proof-clear boundary
        () => false
      ))
    ) {
      throw new AutomaticEnrollmentCleanupRequiredError({
        cleanupProofCleared: false,
        enrollmentId: null,
        enrollmentRevoked: true,
        localPurged,
        preferenceDisabled: true,
        subjectVerified: true,
      });
    }
  });
};

// subscribe to the detail-free credited signal
export const listenForAutomaticLeaderboardChanges = async (
  listener: () => void,
  plugin?: AutomaticLeaderboardCheckinsPluginV1 | null
): Promise<(() => Promise<void>) | null> => {
  const bridge = plugin ?? (await getAutomaticLeaderboardPlugin());
  // keep web views free of native listeners
  if (!bridge) {
    return null;
  }
  const handle = await bridge.addListener(
    AUTOMATIC_LEADERBOARD_CHANGED_EVENT,
    // ignore all native event data
    () => listener()
  );
  return async () => await handle.remove();
};
