import {
  createHash,
  createHmac,
  randomBytes as createRandomBytes,
} from "node:crypto";

import { Op, type Transaction } from "sequelize";
import {
  AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
  AUTOMATIC_CHECKIN_CAPABILITY_VERSION,
  AUTOMATIC_CHECKIN_NATIVE_SCOPES,
  AUTOMATIC_CHECKIN_SCHEMA_VERSION,
  type AutomaticCheckinCredentialExpiryBucket,
  type AutomaticCheckinNativeScope,
  type AutomaticEnrollmentBootstrapRequestV1,
  type AutomaticEnrollmentCredentialV1,
  type AutomaticEnrollmentDevicesV1,
  type AutomaticEnrollmentDeviceV1,
  type AutomaticEnrollmentDisableResultV1,
  type AutomaticEnrollmentHealthResultV1,
  type AutomaticEnrollmentHealthUpdateV1,
  type AutomaticEnrollmentRotationRequestV1,
  type AutomaticNativeEndpointUrlsV1,
  type AutomaticNativePolicyStatusV1,
  type AutomaticNativeRevokeResultV1,
} from "shared/contracts/leaderboards";
import { isObject } from "shared/lib/objects";

import { db } from "~/lib/db";
import {
  advanceServerPolicyGeneration,
  evaluateLeaderboardAutomaticPolicy,
  getServerPolicyGeneration,
  type LockedLeaderboardAutomaticPolicy,
  lockLeaderboardAutomaticPolicy,
  withLeaderboardAutomaticPolicyTransaction,
} from "~/lib/leaderboardAutomaticPolicy";
import {
  LeaderboardAutomaticEnrollment,
  type LeaderboardAutomaticEnrollmentHealth,
  type LeaderboardAutomaticNativeScope,
} from "~/models/LeaderboardAutomaticEnrollment";
import { loadCurrentAutomaticTerminalConfig } from "~/services/leaderboardAutomaticNativeConfig";

const TOKEN_BYTE_LENGTH = 32;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_32_BYTE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const AUTOMATIC_ENROLLMENT_TOKEN_TTL_MS = 30 * ONE_DAY_MS;
export const AUTOMATIC_ENROLLMENT_ROTATE_BEFORE_MS = ONE_WEEK_MS;
export const AUTOMATIC_ENROLLMENT_PREDECESSOR_OVERLAP_MS = ONE_DAY_MS;
export const AUTOMATIC_ENROLLMENT_DEPENDENCY_RETENTION_MS = ONE_WEEK_MS;

/** provisional credential lifecycle windows */
export interface AutomaticEnrollmentTokenPolicy {
  dependencyRetentionMs: number;
  predecessorOverlapMs: number;
  rotateBeforeMs: number;
  tokenTtlMs: number;
}

/** injectable enrollment runtime dependencies */
export interface AutomaticEnrollmentServiceOptions {
  baseUrl?: string;
  ensureConfigReady?: (now: Date) => Promise<void>;
  now?: Date;
  pepper?: string;
  randomBytes?: (size: number) => Buffer;
  tokenPolicy?: Partial<AutomaticEnrollmentTokenPolicy>;
}

// name one fixed enrollment failure
export type AutomaticEnrollmentErrorCode =
  | "automatic_policy_disabled"
  | "credential_configuration_unavailable"
  | "enrollment_expired"
  | "enrollment_not_found"
  | "enrollment_revoked"
  | "installation_mismatch"
  | "invalid_enrollment_request"
  | "rotation_in_progress"
  | "rotation_not_due"
  | "rotation_not_pending"
  | "unsupported_os";

/** fixed detail-free enrollment failure */
export class AutomaticEnrollmentError extends Error {
  code: AutomaticEnrollmentErrorCode;
  status: number;

  // construct one fixed lifecycle failure
  constructor(code: AutomaticEnrollmentErrorCode, status: number) {
    super(code);
    this.code = code;
    this.name = "AutomaticEnrollmentError";
    this.status = status;
  }
}

/** authenticated enrollment application identity */
export interface AuthenticatedAutomaticEnrollmentContext {
  enrollmentId: string;
  enrollmentLimiterDigest: string;
  platform: "android" | "ios";
  scopes: LeaderboardAutomaticNativeScope[];
  serverPolicyGeneration: number;
  subject: string;
}

/** bootstrap-safe detector policy */
export interface AuthenticatedAutomaticEnrollmentConfigPolicy {
  serverPolicyGeneration: number;
  terminalEnabled: boolean;
  vesselEnabled: false;
}

// name one authentication terminal failure
export type AutomaticEnrollmentAuthenticationFailure =
  | "authentication_failed"
  | "enrollment_expired"
  | "enrollment_revoked";

// model one fixed authentication result
export type AutomaticEnrollmentAuthenticationResult =
  | {
      authenticated: false;
      outcome: AutomaticEnrollmentAuthenticationFailure;
      serverPolicyGeneration: number | null;
    }
  | {
      authenticated: true;
      context: AuthenticatedAutomaticEnrollmentContext;
    };

// collect resolved runtime dependencies
interface ResolvedAutomaticEnrollmentRuntime {
  baseUrl: string;
  now: Date;
  pepper: string;
  randomBytes: (size: number) => Buffer;
  tokenPolicy: AutomaticEnrollmentTokenPolicy;
}

// bind raw issuance to its persisted digest
interface IssuedAutomaticToken {
  digest: string;
  raw: string;
}

// expose repeat-safe revocation state
interface AutomaticEnrollmentRevocationResult {
  revoked: boolean;
  serverPolicyGeneration: number;
}

// compare strict object keys
const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean => {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);

  // reject missing required keys
  for (const key of required) {
    // require every key
    if (!(key in value)) {
      return false;
    }
  }

  // reject unknown keys
  return keys.every((key) => allowed.has(key));
};

// validate one opaque uuid
const isUuid = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);

// validate one canonical installation nonce
const isInstallationNonce = (value: unknown): value is string => {
  // require one canonical 256-bit value
  if (typeof value !== "string" || !BASE64URL_32_BYTE_PATTERN.test(value)) {
    return false;
  }

  return (
    Buffer.from(value, "base64url").length === TOKEN_BYTE_LENGTH &&
    Buffer.from(value, "base64url").toString("base64url") === value
  );
};

/** parses one strict auth0 bootstrap request */
export const parseAutomaticEnrollmentBootstrapRequest = (
  input: unknown
): AutomaticEnrollmentBootstrapRequestV1 | null => {
  // require one exact object
  if (
    !isObject(input) ||
    !hasExactKeys(
      input,
      ["capabilityVersion", "installationNonce", "platform", "schemaVersion"],
      ["androidSdkInt", "replacesEnrollmentId"]
    )
  ) {
    return null;
  }

  const {
    androidSdkInt,
    capabilityVersion,
    installationNonce,
    platform,
    replacesEnrollmentId,
    schemaVersion,
  } = input;
  // require the fixed shared versions
  if (
    schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION ||
    capabilityVersion !== AUTOMATIC_CHECKIN_CAPABILITY_VERSION ||
    (platform !== "android" && platform !== "ios") ||
    !isInstallationNonce(installationNonce) ||
    (replacesEnrollmentId !== undefined && !isUuid(replacesEnrollmentId))
  ) {
    return null;
  }

  // require and bound the android api level
  if (
    platform === "android" &&
    (!Number.isInteger(androidSdkInt) ||
      (androidSdkInt as number) < 0 ||
      (androidSdkInt as number) > 10_000)
  ) {
    return null;
  }

  // prohibit android-only fields on ios
  if (platform === "ios" && androidSdkInt !== undefined) {
    return null;
  }

  return input as unknown as AutomaticEnrollmentBootstrapRequestV1;
};

/** parses one strict device health update */
export const parseAutomaticEnrollmentHealthUpdate = (
  input: unknown
): AutomaticEnrollmentHealthUpdateV1 | null => {
  // require one exact object
  if (
    !isObject(input) ||
    !hasExactKeys(input, [
      "detectorEnabled",
      "health",
      "installationNonce",
      "schemaVersion",
    ])
  ) {
    return null;
  }

  // require fixed health semantics
  if (
    input.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION ||
    typeof input.detectorEnabled !== "boolean" ||
    !isInstallationNonce(input.installationNonce) ||
    !["degraded", "disabled", "healthy", "pending"].includes(
      input.health as string
    )
  ) {
    return null;
  }

  return input as unknown as AutomaticEnrollmentHealthUpdateV1;
};

/** parses one strict credential rotation request */
export const parseAutomaticEnrollmentRotationRequest = (
  input: unknown
): AutomaticEnrollmentRotationRequestV1 | null => {
  // require one exact bound request
  if (
    !isObject(input) ||
    !hasExactKeys(input, ["installationNonce", "schemaVersion"]) ||
    input.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION ||
    !isInstallationNonce(input.installationNonce)
  ) {
    return null;
  }

  return input as unknown as AutomaticEnrollmentRotationRequestV1;
};

// validate one lifecycle duration
const isDuration = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

// resolve one provisional token policy
const resolveTokenPolicy = (
  override: Partial<AutomaticEnrollmentTokenPolicy> = {}
): AutomaticEnrollmentTokenPolicy => {
  const policy = {
    dependencyRetentionMs:
      override.dependencyRetentionMs ??
      AUTOMATIC_ENROLLMENT_DEPENDENCY_RETENTION_MS,
    predecessorOverlapMs:
      override.predecessorOverlapMs ??
      AUTOMATIC_ENROLLMENT_PREDECESSOR_OVERLAP_MS,
    rotateBeforeMs:
      override.rotateBeforeMs ?? AUTOMATIC_ENROLLMENT_ROTATE_BEFORE_MS,
    tokenTtlMs: override.tokenTtlMs ?? AUTOMATIC_ENROLLMENT_TOKEN_TTL_MS,
  };

  // fail closed on unsafe lifecycle windows
  if (
    !isDuration(policy.dependencyRetentionMs) ||
    !isDuration(policy.predecessorOverlapMs) ||
    !isDuration(policy.rotateBeforeMs) ||
    !isDuration(policy.tokenTtlMs) ||
    policy.tokenTtlMs === 0 ||
    policy.rotateBeforeMs >= policy.tokenTtlMs ||
    policy.predecessorOverlapMs === 0 ||
    policy.predecessorOverlapMs > policy.tokenTtlMs ||
    policy.dependencyRetentionMs < AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS
  ) {
    throw new AutomaticEnrollmentError(
      "credential_configuration_unavailable",
      503
    );
  }

  return policy;
};

// resolve the dedicated credential pepper
const resolvePepper = (value?: string): string => {
  const pepper = value ?? process.env.LEADERBOARD_AUTOMATIC_TOKEN_PEPPER;

  // require a dedicated nontrivial secret
  if (typeof pepper !== "string" || pepper.length < 32) {
    throw new AutomaticEnrollmentError(
      "credential_configuration_unavailable",
      503
    );
  }

  return pepper;
};

// allow only trusted server origins
const resolveBaseUrl = (value?: string): string => {
  const configured = value ?? process.env.BASE_URL;

  // require one configured server origin
  if (typeof configured !== "string") {
    throw new AutomaticEnrollmentError(
      "credential_configuration_unavailable",
      503
    );
  }

  let parsed: URL;
  // normalize url failures
  try {
    parsed = new URL(configured);
  } catch {
    // reject malformed configuration
    throw new AutomaticEnrollmentError(
      "credential_configuration_unavailable",
      503
    );
  }

  const debugLocal =
    process.env.NODE_ENV !== "production" &&
    parsed.protocol === "http:" &&
    ["127.0.0.1", "::1", "localhost"].includes(parsed.hostname);
  // require an exact trusted origin
  if (
    (parsed.protocol !== "https:" && !debugLocal) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new AutomaticEnrollmentError(
      "credential_configuration_unavailable",
      503
    );
  }

  return parsed.origin;
};

// resolve injectable runtime dependencies
const resolveRuntime = (
  options: AutomaticEnrollmentServiceOptions = {}
): ResolvedAutomaticEnrollmentRuntime => ({
  baseUrl: resolveBaseUrl(options.baseUrl),
  now: options.now ?? new Date(),
  pepper: resolvePepper(options.pepper),
  randomBytes: options.randomBytes ?? createRandomBytes,
  tokenPolicy: resolveTokenPolicy(options.tokenPolicy),
});

// require one validated durable terminal configuration
const ensureAutomaticEnrollmentReadiness = async (
  now: Date,
  readiness?: (now: Date) => Promise<void>
): Promise<void> => {
  // normalize every fail-closed readiness failure
  try {
    if (readiness) {
      await readiness(now);
      return;
    }
    await loadCurrentAutomaticTerminalConfig(undefined, now);
  } catch {
    // redact durable readiness details
    throw new AutomaticEnrollmentError(
      "credential_configuration_unavailable",
      503
    );
  }
};

/** builds exact native urls from trusted server configuration */
export const automaticEnrollmentNativeUrls = (
  baseUrl?: string
): AutomaticNativeEndpointUrlsV1 => {
  const origin = resolveBaseUrl(baseUrl);
  return {
    candidates: `${origin}/api/leaderboards/native/candidates`,
    config: `${origin}/api/leaderboards/native/config`,
    enrollment: `${origin}/api/leaderboards/native/enrollment`,
    status: `${origin}/api/leaderboards/native/status`,
  };
};

// compute one peppered token digest
const tokenDigest = (token: string, pepper: string): string =>
  createHmac("sha256", pepper).update(token, "utf8").digest("hex");

// compute one nonreversible installation binding
const installationNonceHash = (nonce: string): string =>
  createHash("sha256").update(nonce, "utf8").digest("hex");

// compute one rotation-stable limiter identity
const enrollmentLimiterDigest = (
  enrollmentId: string,
  pepper: string
): string =>
  createHmac("sha256", pepper)
    .update(`leaderboard-automatic-limiter-v1:${enrollmentId}`, "utf8")
    .digest("hex");

// issue one 256-bit opaque bearer
const issueAutomaticToken = (
  randomBytes: (size: number) => Buffer,
  pepper: string
): IssuedAutomaticToken => {
  const bytes = randomBytes(TOKEN_BYTE_LENGTH);

  // require the exact entropy request result
  if (!Buffer.isBuffer(bytes) || bytes.length !== TOKEN_BYTE_LENGTH) {
    throw new AutomaticEnrollmentError(
      "credential_configuration_unavailable",
      503
    );
  }

  const raw = bytes.toString("base64url");
  bytes.fill(0);
  return { digest: tokenDigest(raw, pepper), raw };
};

// select one locked enrollment
const findLockedEnrollment = (
  policy: LockedLeaderboardAutomaticPolicy,
  enrollmentId: string
): LeaderboardAutomaticEnrollment | undefined =>
  // match only the requested opaque identity
  policy.enrollments.find(
    (enrollment) => enrollment.enrollmentId === enrollmentId
  );

// check one credential-active row
const hasActiveCredential = (
  enrollment: LeaderboardAutomaticEnrollment,
  now: Date
): boolean =>
  enrollment.revokedAt === null &&
  enrollment.tokenExpiresAt.getTime() > now.getTime();

// serialize one device-management row
const serializeAutomaticEnrollmentDevice = (
  enrollment: LeaderboardAutomaticEnrollment,
  now: Date
): AutomaticEnrollmentDeviceV1 => ({
  active: hasActiveCredential(enrollment, now),
  capabilityVersion: AUTOMATIC_CHECKIN_CAPABILITY_VERSION,
  detectorEnabled: enrollment.detectorEnabled,
  enrollmentId: enrollment.enrollmentId,
  expiresAtMs: enrollment.tokenExpiresAt.getTime(),
  health: enrollment.health,
  platform: enrollment.platform,
  revokedAtMs: enrollment.revokedAt?.getTime() ?? null,
});

// revoke one locked enrollment
const revokeLockedEnrollment = async (
  enrollment: LeaderboardAutomaticEnrollment,
  now: Date,
  transaction: Transaction
): Promise<boolean> => {
  // preserve repeat-safe revocation
  if (enrollment.revokedAt !== null) {
    return false;
  }

  await enrollment.update(
    {
      detectorEnabled: false,
      health: "disabled",
      healthUpdatedAt: now,
      revokedAt: now,
    },
    { transaction }
  );
  return true;
};

// retire one newly observed expired enrollment
export const retireExpiredAutomaticEnrollment = async (
  enrollment: LeaderboardAutomaticEnrollment,
  now: Date,
  transaction: Transaction
): Promise<boolean> => {
  // require the expiry boundary and one new observation
  if (
    enrollment.tokenExpiresAt.getTime() > now.getTime() ||
    enrollment.expiryObservedAt !== null
  ) {
    return false;
  }

  await enrollment.update(
    {
      detectorEnabled: false,
      expiryObservedAt: now,
      health: "disabled",
      healthUpdatedAt: now,
    },
    { transaction }
  );
  return true;
};

/** exactly-once expiry observation */
export interface ObservedAutomaticEnrollmentExpiry {
  observed: boolean;
  serverPolicyGeneration: number;
}

/** observes expiry and advances its policy generation once */
export const observeAutomaticEnrollmentExpiry = async (
  enrollment: LeaderboardAutomaticEnrollment,
  policy: LockedLeaderboardAutomaticPolicy,
  now: Date
): Promise<ObservedAutomaticEnrollmentExpiry> => {
  const observed = await retireExpiredAutomaticEnrollment(
    enrollment,
    now,
    policy.transaction
  );
  return {
    observed,
    serverPolicyGeneration: observed
      ? await advanceServerPolicyGeneration(policy)
      : getServerPolicyGeneration(policy),
  };
};

/** checks whether the configured rotate-before window has opened */
export const shouldRotateAutomaticEnrollment = (
  enrollment: Pick<
    LeaderboardAutomaticEnrollment,
    "revokedAt" | "tokenExpiresAt"
  >,
  now: Date,
  rotateBeforeMs = AUTOMATIC_ENROLLMENT_ROTATE_BEFORE_MS
): boolean =>
  enrollment.revokedAt === null &&
  enrollment.tokenExpiresAt.getTime() > now.getTime() &&
  enrollment.tokenExpiresAt.getTime() - now.getTime() <= rotateBeforeMs;

/** creates one auth0-bound installation enrollment */
export const createAutomaticEnrollment = async (
  subject: string,
  request: AutomaticEnrollmentBootstrapRequestV1,
  options: AutomaticEnrollmentServiceOptions = {}
): Promise<AutomaticEnrollmentCredentialV1> => {
  const parsed = parseAutomaticEnrollmentBootstrapRequest(request);

  // reject malformed direct callers
  if (!parsed) {
    throw new AutomaticEnrollmentError("invalid_enrollment_request", 400);
  }

  // enforce the production android floor
  if (parsed.platform === "android" && (parsed.androidSdkInt as number) < 29) {
    throw new AutomaticEnrollmentError("unsupported_os", 422);
  }

  const runtime = resolveRuntime(options);
  const nonceHash = installationNonceHash(parsed.installationNonce);
  const urls = automaticEnrollmentNativeUrls(runtime.baseUrl);
  await ensureAutomaticEnrollmentReadiness(
    runtime.now,
    options.ensureConfigReady
  );
  const result = await withLeaderboardAutomaticPolicyTransaction(
    { createProfile: true, subject },
    // issue one policy-linearized enrollment
    async (policy) => {
      const effective = evaluateLeaderboardAutomaticPolicy(policy, runtime.now);

      // require both feature boundaries and participation
      if (
        !effective.parentFlagEnabled ||
        !effective.automaticFlagEnabled ||
        !policy.profile ||
        policy.profile.optedOut
      ) {
        throw new AutomaticEnrollmentError("automatic_policy_disabled", 403);
      }

      const replacement = parsed.replacesEnrollmentId
        ? findLockedEnrollment(policy, parsed.replacesEnrollmentId)
        : undefined;
      // require an explicitly addressed owned enrollment
      if (parsed.replacesEnrollmentId && !replacement) {
        throw new AutomaticEnrollmentError("enrollment_not_found", 404);
      }

      // revoke replayed or explicitly replaced installations
      for (const enrollment of policy.enrollments) {
        const shouldReplace =
          enrollment.installationNonceHash === nonceHash ||
          enrollment.enrollmentId === parsed.replacesEnrollmentId;
        // revoke only matching prior identities
        if (shouldReplace) {
          await revokeLockedEnrollment(
            enrollment,
            runtime.now,
            policy.transaction
          );
        }
      }

      const issued = issueAutomaticToken(runtime.randomBytes, runtime.pepper);
      const tokenExpiresAt = new Date(
        runtime.now.getTime() + runtime.tokenPolicy.tokenTtlMs
      );
      const enrollment = await LeaderboardAutomaticEnrollment.create(
        {
          capabilityVersion: AUTOMATIC_CHECKIN_CAPABILITY_VERSION,
          currentTokenDigest: issued.digest,
          detectorEnabled: false,
          expiryObservedAt: null,
          health: "pending",
          healthUpdatedAt: runtime.now,
          installationNonceHash: nonceHash,
          platform: parsed.platform,
          predecessorAcknowledgedAt: null,
          predecessorTokenDigest: null,
          predecessorValidUntil: null,
          revokedAt: null,
          scopes: [...AUTOMATIC_CHECKIN_NATIVE_SCOPES],
          subject,
          tokenExpiresAt,
          tokenIssuedAt: runtime.now,
          tokenRotatedAt: null,
        },
        { transaction: policy.transaction }
      );
      const serverPolicyGeneration =
        await advanceServerPolicyGeneration(policy);
      return { enrollment, issued, serverPolicyGeneration, tokenExpiresAt };
    }
  );

  return {
    bearerToken: result.issued.raw,
    enrollmentId: result.enrollment.enrollmentId,
    expiresAtMs: result.tokenExpiresAt.getTime(),
    rotateAfterMs:
      result.tokenExpiresAt.getTime() - runtime.tokenPolicy.rotateBeforeMs,
    schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
    scopes: [...AUTOMATIC_CHECKIN_NATIVE_SCOPES],
    serverPolicyGeneration: result.serverPolicyGeneration,
    urls,
  };
};

/** lists privacy-minimal auth0 device-management rows */
export const listAutomaticEnrollments = async (
  subject: string,
  now = new Date()
): Promise<AutomaticEnrollmentDevicesV1> =>
  await withLeaderboardAutomaticPolicyTransaction(
    { subject },
    // serialize one consistent locked view
    async (policy) => {
      // observe expired identities during device management
      for (const enrollment of policy.enrollments) {
        // linearize only unrevoked expiry
        if (
          enrollment.revokedAt === null &&
          enrollment.tokenExpiresAt.getTime() <= now.getTime()
        ) {
          await observeAutomaticEnrollmentExpiry(enrollment, policy, now);
        }
      }
      return {
        // serialize each owned installation
        enrollments: policy.enrollments.map((enrollment) =>
          serializeAutomaticEnrollmentDevice(enrollment, now)
        ),
        schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
        serverPolicyGeneration: getServerPolicyGeneration(policy),
      };
    }
  );

/** updates aggregate detector health after native registration */
export const updateAutomaticEnrollmentHealth = async (
  subject: string,
  enrollmentId: string,
  request: AutomaticEnrollmentHealthUpdateV1,
  now = new Date()
): Promise<AutomaticEnrollmentHealthResultV1> => {
  const parsed = parseAutomaticEnrollmentHealthUpdate(request);

  // reject malformed direct callers
  if (!parsed || !isUuid(enrollmentId)) {
    throw new AutomaticEnrollmentError("invalid_enrollment_request", 400);
  }

  const nonceHash = installationNonceHash(parsed.installationNonce);
  const result = await withLeaderboardAutomaticPolicyTransaction(
    { enrollmentId, subject },
    // update one bound installation
    async (policy) => {
      const enrollment = findLockedEnrollment(policy, enrollmentId);

      // require one owned enrollment
      if (!enrollment) {
        return {
          error: "enrollment_not_found" as const,
          status: 404,
          success: false as const,
        };
      }

      // revoke a mismatched installation binding
      if (enrollment.installationNonceHash !== nonceHash) {
        await revokeLockedEnrollment(enrollment, now, policy.transaction);
        const serverPolicyGeneration =
          await advanceServerPolicyGeneration(policy);
        return {
          error: "installation_mismatch" as const,
          serverPolicyGeneration,
          status: 409,
          success: false as const,
        };
      }

      // reject inactive credentials
      if (enrollment.revokedAt !== null) {
        return {
          error: "enrollment_revoked" as const,
          status: 410,
          success: false as const,
        };
      }
      // reject expired credentials
      if (enrollment.tokenExpiresAt.getTime() <= now.getTime()) {
        await observeAutomaticEnrollmentExpiry(enrollment, policy, now);
        return {
          error: "enrollment_expired" as const,
          status: 410,
          success: false as const,
        };
      }

      const changed =
        enrollment.detectorEnabled !== parsed.detectorEnabled ||
        enrollment.health !== parsed.health;
      await enrollment.update(
        {
          detectorEnabled: parsed.detectorEnabled,
          health: parsed.health as LeaderboardAutomaticEnrollmentHealth,
          healthUpdatedAt: now,
        },
        { transaction: policy.transaction }
      );
      const serverPolicyGeneration = changed
        ? await advanceServerPolicyGeneration(policy)
        : getServerPolicyGeneration(policy);
      return {
        enrollment,
        serverPolicyGeneration,
        success: true as const,
      };
    }
  );

  // expose only fixed lifecycle failures
  if (!result.success) {
    throw new AutomaticEnrollmentError(result.error, result.status);
  }

  return {
    enrollment: serializeAutomaticEnrollmentDevice(result.enrollment, now),
    schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
    serverPolicyGeneration: result.serverPolicyGeneration,
  };
};

/** revokes one auth0-owned or authenticated native enrollment */
export const revokeAutomaticEnrollment = async (
  subject: string,
  enrollmentId: string,
  now = new Date()
): Promise<AutomaticEnrollmentRevocationResult> => {
  // require one opaque identity
  if (!isUuid(enrollmentId)) {
    throw new AutomaticEnrollmentError("invalid_enrollment_request", 400);
  }

  return await withLeaderboardAutomaticPolicyTransaction(
    { enrollmentId, subject },
    // revoke one locked installation
    async (policy) => {
      const enrollment = findLockedEnrollment(policy, enrollmentId);

      // require one owned enrollment
      if (!enrollment) {
        throw new AutomaticEnrollmentError("enrollment_not_found", 404);
      }

      const revoked = await revokeLockedEnrollment(
        enrollment,
        now,
        policy.transaction
      );
      const serverPolicyGeneration = revoked
        ? await advanceServerPolicyGeneration(policy)
        : getServerPolicyGeneration(policy);
      return { revoked, serverPolicyGeneration };
    }
  );
};

/** disables every auth0-owned automatic enrollment without rollout admission */
export const disableAutomaticEnrollments = async (
  subject: string,
  now = new Date()
): Promise<AutomaticEnrollmentDisableResultV1> =>
  await withLeaderboardAutomaticPolicyTransaction(
    { subject },
    // commit one idempotent account-wide disable
    async (policy) => {
      let changed = false;

      // disable the stored preference when the profile exists
      if (policy.profile?.automaticCheckinsEnabled === true) {
        await policy.profile.update(
          { automaticCheckinsEnabled: false },
          { transaction: policy.transaction }
        );
        changed = true;
      }

      // revoke every still-active installation
      for (const enrollment of policy.enrollments) {
        // preserve already-revoked rows
        if (await revokeLockedEnrollment(enrollment, now, policy.transaction)) {
          changed = true;
        }
      }

      const serverPolicyGeneration = changed
        ? await advanceServerPolicyGeneration(policy)
        : getServerPolicyGeneration(policy);
      return {
        disabled: true,
        schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
        serverPolicyGeneration,
      };
    }
  );

/** rotates one due credential with bounded predecessor overlap */
export const rotateAutomaticEnrollmentCredential = async (
  subject: string,
  enrollmentId: string,
  installationNonce: string,
  options: AutomaticEnrollmentServiceOptions = {}
): Promise<AutomaticEnrollmentCredentialV1> => {
  // require one bound opaque identity
  if (!isUuid(enrollmentId) || !isInstallationNonce(installationNonce)) {
    throw new AutomaticEnrollmentError("invalid_enrollment_request", 400);
  }

  const runtime = resolveRuntime(options);
  const nonceHash = installationNonceHash(installationNonce);
  const urls = automaticEnrollmentNativeUrls(runtime.baseUrl);
  await ensureAutomaticEnrollmentReadiness(
    runtime.now,
    options.ensureConfigReady
  );
  const result = await withLeaderboardAutomaticPolicyTransaction(
    { enrollmentId, subject },
    // rotate one locked credential
    async (policy) => {
      const enrollment = findLockedEnrollment(policy, enrollmentId);

      // require one owned enrollment
      if (!enrollment) {
        return {
          error: "enrollment_not_found" as const,
          status: 404,
          success: false as const,
        };
      }

      // revoke a mismatched installation binding
      if (enrollment.installationNonceHash !== nonceHash) {
        await revokeLockedEnrollment(
          enrollment,
          runtime.now,
          policy.transaction
        );
        await advanceServerPolicyGeneration(policy);
        return {
          error: "installation_mismatch" as const,
          status: 409,
          success: false as const,
        };
      }

      // reject inactive credentials
      if (enrollment.revokedAt !== null) {
        return {
          error: "enrollment_revoked" as const,
          status: 410,
          success: false as const,
        };
      }
      // reject expired credentials
      if (enrollment.tokenExpiresAt.getTime() <= runtime.now.getTime()) {
        await observeAutomaticEnrollmentExpiry(enrollment, policy, runtime.now);
        return {
          error: "enrollment_expired" as const,
          status: 410,
          success: false as const,
        };
      }

      const predecessorStillActive =
        enrollment.predecessorTokenDigest !== null &&
        enrollment.predecessorAcknowledgedAt === null &&
        enrollment.predecessorValidUntil !== null &&
        enrollment.predecessorValidUntil.getTime() > runtime.now.getTime();
      // preserve the current overlap
      if (predecessorStillActive) {
        return {
          error: "rotation_in_progress" as const,
          status: 409,
          success: false as const,
        };
      }

      // rotate only inside the configured window
      if (
        !shouldRotateAutomaticEnrollment(
          enrollment,
          runtime.now,
          runtime.tokenPolicy.rotateBeforeMs
        )
      ) {
        return {
          error: "rotation_not_due" as const,
          status: 409,
          success: false as const,
        };
      }

      const issued = issueAutomaticToken(runtime.randomBytes, runtime.pepper);
      const tokenExpiresAt = new Date(
        runtime.now.getTime() + runtime.tokenPolicy.tokenTtlMs
      );
      const predecessorValidUntil = new Date(
        Math.min(
          enrollment.tokenExpiresAt.getTime(),
          runtime.now.getTime() + runtime.tokenPolicy.predecessorOverlapMs,
          tokenExpiresAt.getTime()
        )
      );
      await enrollment.update(
        {
          currentTokenDigest: issued.digest,
          expiryObservedAt: null,
          predecessorAcknowledgedAt: null,
          predecessorTokenDigest: enrollment.currentTokenDigest,
          predecessorValidUntil,
          tokenExpiresAt,
          tokenIssuedAt: runtime.now,
          tokenRotatedAt: runtime.now,
        },
        { transaction: policy.transaction }
      );
      return {
        enrollment,
        issued,
        serverPolicyGeneration: getServerPolicyGeneration(policy),
        success: true as const,
        tokenExpiresAt,
      };
    }
  );

  // expose only fixed lifecycle failures
  if (!result.success) {
    throw new AutomaticEnrollmentError(result.error, result.status);
  }

  return {
    bearerToken: result.issued.raw,
    enrollmentId: result.enrollment.enrollmentId,
    expiresAtMs: result.tokenExpiresAt.getTime(),
    rotateAfterMs:
      result.tokenExpiresAt.getTime() - runtime.tokenPolicy.rotateBeforeMs,
    schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
    scopes: [...AUTOMATIC_CHECKIN_NATIVE_SCOPES],
    serverPolicyGeneration: result.serverPolicyGeneration,
    urls,
  };
};

/** ends predecessor overlap after native acknowledgement */
export const acknowledgeAutomaticEnrollmentRotation = async (
  subject: string,
  enrollmentId: string,
  installationNonce: string,
  now = new Date()
): Promise<AutomaticNativePolicyStatusV1> => {
  // require one bound opaque identity
  if (!isUuid(enrollmentId) || !isInstallationNonce(installationNonce)) {
    throw new AutomaticEnrollmentError("invalid_enrollment_request", 400);
  }

  const nonceHash = installationNonceHash(installationNonce);
  const result = await withLeaderboardAutomaticPolicyTransaction(
    { enrollmentId, subject },
    // acknowledge one locked rotation
    async (policy) => {
      const enrollment = findLockedEnrollment(policy, enrollmentId);

      // require one owned enrollment
      if (!enrollment) {
        return {
          error: "enrollment_not_found" as const,
          status: 404,
          success: false as const,
        };
      }

      // revoke a mismatched installation binding
      if (enrollment.installationNonceHash !== nonceHash) {
        await revokeLockedEnrollment(enrollment, now, policy.transaction);
        await advanceServerPolicyGeneration(policy);
        return {
          error: "installation_mismatch" as const,
          status: 409,
          success: false as const,
        };
      }

      // require one pending or completed rotation
      if (
        !enrollment.predecessorTokenDigest ||
        !enrollment.predecessorValidUntil ||
        !enrollment.tokenRotatedAt
      ) {
        return {
          error: "rotation_not_pending" as const,
          status: 409,
          success: false as const,
        };
      }

      // commit the first acknowledgement only
      if (enrollment.predecessorAcknowledgedAt === null) {
        await enrollment.update(
          {
            predecessorAcknowledgedAt: now,
            predecessorValidUntil: now,
          },
          { transaction: policy.transaction }
        );
      }

      return { enrollment, policy, success: true as const };
    }
  );

  // expose only fixed lifecycle failures
  if (!result.success) {
    throw new AutomaticEnrollmentError(result.error, result.status);
  }

  return serializeNativePolicyStatus(result.policy, result.enrollment, now);
};

// revoke ambiguous token matches atomically
const revokeConflictingTokenMatches = async (
  enrollments: LeaderboardAutomaticEnrollment[],
  now: Date
): Promise<number> => {
  // project affected subjects
  const subjects = [
    ...new Set(enrollments.map(({ subject }) => subject)),
  ].sort();
  // project affected enrollments
  const enrollmentIds = new Set(
    enrollments.map(({ enrollmentId }) => enrollmentId)
  );

  // linearize every affected subject under shared policy locks
  return await db.transaction(async (transaction) => {
    let serverPolicyGeneration = 0;
    // lock subjects deterministically
    for (const subject of subjects) {
      const policy = await lockLeaderboardAutomaticPolicy(transaction, {
        subject,
      });
      let changed = false;
      // revoke only conflicting enrollment identities
      for (const enrollment of policy.enrollments) {
        // match the pre-auth collision set
        if (enrollmentIds.has(enrollment.enrollmentId)) {
          changed =
            (await revokeLockedEnrollment(enrollment, now, transaction)) ||
            changed;
        }
      }
      // advance each changed policy view
      if (changed) {
        serverPolicyGeneration = await advanceServerPolicyGeneration(policy);
      } else {
        serverPolicyGeneration = getServerPolicyGeneration(policy);
      }
    }
    return serverPolicyGeneration;
  });
};

/** authenticates one scoped current or bounded predecessor bearer */
export const authenticateAutomaticEnrollmentBearer = async (
  bearerToken: string,
  requiredScope: AutomaticCheckinNativeScope,
  options: AutomaticEnrollmentServiceOptions = {}
): Promise<AutomaticEnrollmentAuthenticationResult> => {
  // reject malformed tokens and scope names before persistence
  if (
    !BASE64URL_32_BYTE_PATTERN.test(bearerToken) ||
    !AUTOMATIC_CHECKIN_NATIVE_SCOPES.includes(requiredScope)
  ) {
    return {
      authenticated: false,
      outcome: "authentication_failed",
      serverPolicyGeneration: null,
    };
  }

  const runtime = resolveRuntime(options);
  const digest = tokenDigest(bearerToken, runtime.pepper);
  const matches = await LeaderboardAutomaticEnrollment.findAll({
    limit: 2,
    where: {
      [Op.or]: [
        { currentTokenDigest: digest },
        { predecessorTokenDigest: digest },
      ],
    },
  });

  // reject unknown credentials
  if (matches.length === 0) {
    return {
      authenticated: false,
      outcome: "authentication_failed",
      serverPolicyGeneration: null,
    };
  }

  // revoke ambiguous credentials before denial
  if (matches.length !== 1) {
    const serverPolicyGeneration = await revokeConflictingTokenMatches(
      matches,
      runtime.now
    );
    return {
      authenticated: false,
      outcome: "authentication_failed",
      serverPolicyGeneration,
    };
  }

  const match = matches[0];
  return await withLeaderboardAutomaticPolicyTransaction(
    { enrollmentId: match.enrollmentId, subject: match.subject },
    // recheck the token under policy locks
    async (policy) => {
      const enrollment = findLockedEnrollment(policy, match.enrollmentId);

      // reject enrollment removal races
      if (!enrollment) {
        return {
          authenticated: false,
          outcome: "authentication_failed",
          serverPolicyGeneration: getServerPolicyGeneration(policy),
        };
      }

      // reject committed revocation
      if (enrollment.revokedAt !== null) {
        return {
          authenticated: false,
          outcome: "enrollment_revoked",
          serverPolicyGeneration: getServerPolicyGeneration(policy),
        };
      }

      const currentMatch = enrollment.currentTokenDigest === digest;
      const predecessorMatch = enrollment.predecessorTokenDigest === digest;
      // reject current credential expiry
      if (
        currentMatch &&
        enrollment.tokenExpiresAt.getTime() <= runtime.now.getTime()
      ) {
        const observed = await observeAutomaticEnrollmentExpiry(
          enrollment,
          policy,
          runtime.now
        );
        return {
          authenticated: false,
          outcome: "enrollment_expired",
          serverPolicyGeneration: observed.serverPolicyGeneration,
        };
      }

      const predecessorActive =
        predecessorMatch &&
        enrollment.predecessorAcknowledgedAt === null &&
        enrollment.predecessorValidUntil !== null &&
        enrollment.predecessorValidUntil.getTime() > runtime.now.getTime();
      // require one currently admitted digest
      if (!currentMatch && !predecessorActive) {
        return {
          authenticated: false,
          outcome: predecessorMatch
            ? "enrollment_expired"
            : "authentication_failed",
          serverPolicyGeneration: getServerPolicyGeneration(policy),
        };
      }

      // enforce exact least-privilege scope use
      if (!enrollment.scopes.includes(requiredScope)) {
        return {
          authenticated: false,
          outcome: "authentication_failed",
          serverPolicyGeneration: getServerPolicyGeneration(policy),
        };
      }

      return {
        authenticated: true,
        context: {
          enrollmentId: enrollment.enrollmentId,
          enrollmentLimiterDigest: enrollmentLimiterDigest(
            enrollment.enrollmentId,
            runtime.pepper
          ),
          platform: enrollment.platform,
          scopes: [...enrollment.scopes],
          serverPolicyGeneration: getServerPolicyGeneration(policy),
          subject: enrollment.subject,
        },
      };
    }
  );
};

// bucket one credential expiry without exact-time disclosure
const credentialExpiryBucket = (
  enrollment: LeaderboardAutomaticEnrollment,
  now: Date
): AutomaticCheckinCredentialExpiryBucket => {
  const remaining = enrollment.tokenExpiresAt.getTime() - now.getTime();

  // classify expired credentials
  if (remaining <= 0) {
    return "expired";
  }
  // classify near-term rotation
  if (remaining < ONE_DAY_MS) {
    return "less_than_1_day";
  }
  // classify week-scale rotation
  if (remaining < ONE_WEEK_MS) {
    return "less_than_7_days";
  }
  return "seven_days_or_more";
};

// serialize one fixed authenticated policy status
const serializeNativePolicyStatus = (
  policy: LockedLeaderboardAutomaticPolicy,
  enrollment: LeaderboardAutomaticEnrollment,
  now: Date
): AutomaticNativePolicyStatusV1 => ({
  automaticEnabled: evaluateLeaderboardAutomaticPolicy(policy, now, enrollment)
    .automaticEnabled,
  credentialExpiryBucket: credentialExpiryBucket(enrollment, now),
  rotateRecommended: shouldRotateAutomaticEnrollment(enrollment, now),
  schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
  serverPolicyGeneration: getServerPolicyGeneration(policy),
});

/** returns one authenticated fixed native status */
export const getAuthenticatedAutomaticEnrollmentStatus = async (
  context: AuthenticatedAutomaticEnrollmentContext,
  now = new Date()
): Promise<AutomaticNativePolicyStatusV1> =>
  await withLeaderboardAutomaticPolicyTransaction(
    { enrollmentId: context.enrollmentId, subject: context.subject },
    // recheck status under policy locks
    async (policy) => {
      const enrollment = findLockedEnrollment(policy, context.enrollmentId);

      // reject removal races
      if (!enrollment) {
        throw new AutomaticEnrollmentError("enrollment_not_found", 404);
      }

      // linearize expiry crossed after bearer authentication
      if (
        enrollment.revokedAt === null &&
        enrollment.tokenExpiresAt.getTime() <= now.getTime()
      ) {
        await observeAutomaticEnrollmentExpiry(enrollment, policy, now);
      }

      return serializeNativePolicyStatus(policy, enrollment, now);
    }
  );

/** returns bootstrap-safe authenticated detector policy */
export const getAuthenticatedAutomaticEnrollmentConfigPolicy = async (
  context: AuthenticatedAutomaticEnrollmentContext,
  now = new Date()
): Promise<AuthenticatedAutomaticEnrollmentConfigPolicy> =>
  await withLeaderboardAutomaticPolicyTransaction(
    { enrollmentId: context.enrollmentId, subject: context.subject },
    // recheck bootstrap policy under shared locks
    async (policy) => {
      const enrollment = findLockedEnrollment(policy, context.enrollmentId);

      // reject removal races
      if (!enrollment) {
        throw new AutomaticEnrollmentError("enrollment_not_found", 404);
      }

      // linearize expiry crossed after bearer authentication
      if (
        enrollment.revokedAt === null &&
        enrollment.tokenExpiresAt.getTime() <= now.getTime()
      ) {
        await observeAutomaticEnrollmentExpiry(enrollment, policy, now);
      }

      const effective = evaluateLeaderboardAutomaticPolicy(
        policy,
        now,
        enrollment
      );
      const credentialActive =
        enrollment.revokedAt === null &&
        enrollment.tokenExpiresAt.getTime() > now.getTime() &&
        enrollment.scopes.includes("automatic-checkins:config:read");
      return {
        serverPolicyGeneration: getServerPolicyGeneration(policy),
        terminalEnabled:
          effective.parentFlagEnabled &&
          effective.automaticFlagEnabled &&
          policy.profile?.optedOut !== true &&
          credentialActive,
        vesselEnabled: false,
      };
    }
  );

/** commits one authenticated native self-revocation */
export const nativeRevokeAutomaticEnrollment = async (
  context: AuthenticatedAutomaticEnrollmentContext,
  now = new Date()
): Promise<AutomaticNativeRevokeResultV1> => {
  const result = await revokeAutomaticEnrollment(
    context.subject,
    context.enrollmentId,
    now
  );
  return {
    revoked: true,
    schemaVersion: AUTOMATIC_CHECKIN_SCHEMA_VERSION,
    serverPolicyGeneration: result.serverPolicyGeneration,
  };
};

/** checks the explicit dependency-safe cleanup boundary */
export const automaticEnrollmentCleanupEligible = (
  enrollment: Pick<
    LeaderboardAutomaticEnrollment,
    "revokedAt" | "tokenExpiresAt"
  >,
  receiptCount: number,
  now: Date,
  dependencyRetentionMs = AUTOMATIC_ENROLLMENT_DEPENDENCY_RETENTION_MS
): boolean => {
  // retain every referenced enrollment
  if (receiptCount !== 0) {
    return false;
  }

  // reject unsafe cleanup configuration
  if (
    !isDuration(dependencyRetentionMs) ||
    dependencyRetentionMs < AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS
  ) {
    return false;
  }

  const retiredAt = enrollment.revokedAt ?? enrollment.tokenExpiresAt;
  return retiredAt.getTime() + dependencyRetentionMs <= now.getTime();
};

/** prunes only unreferenced enrollments past dependency retention */
export const cleanupAutomaticEnrollments = async (
  options: Pick<AutomaticEnrollmentServiceOptions, "now" | "tokenPolicy"> = {}
): Promise<number> => {
  const now = options.now ?? new Date();
  const tokenPolicy = resolveTokenPolicy(options.tokenPolicy);
  const cutoff = new Date(now.getTime() - tokenPolicy.dependencyRetentionMs);

  const candidates = await LeaderboardAutomaticEnrollment.findAll({
    attributes: ["enrollmentId", "subject"],
    order: [
      ["subject", "ASC"],
      ["enrollmentId", "ASC"],
    ],
    where: {
      [Op.or]: [
        { revokedAt: { [Op.lte]: cutoff } },
        {
          revokedAt: null,
          tokenExpiresAt: { [Op.lte]: cutoff },
        },
      ],
    },
  });
  let removed = 0;
  // recheck each candidate under the global lock order
  for (const candidate of candidates) {
    const deleted = await withLeaderboardAutomaticPolicyTransaction(
      {
        enrollmentId: candidate.enrollmentId,
        lockReceipts: true,
        subject: candidate.subject,
      },
      // delete only one dependency-free locked identity
      async (policy) => {
        const enrollment = findLockedEnrollment(policy, candidate.enrollmentId);

        // retain rows removed or changed after discovery
        if (
          !enrollment ||
          !automaticEnrollmentCleanupEligible(
            enrollment,
            policy.receipts.length,
            now,
            tokenPolicy.dependencyRetentionMs
          )
        ) {
          return false;
        }

        await enrollment.destroy({ transaction: policy.transaction });
        return true;
      }
    );
    // count only committed deletions
    if (deleted) {
      removed += 1;
    }
  }
  return removed;
};
