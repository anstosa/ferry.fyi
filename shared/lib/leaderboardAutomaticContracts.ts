import {
  AUTOMATIC_CHECKIN_AGGREGATE_OUTCOMES,
  AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS,
  AUTOMATIC_CHECKIN_CAPABILITY_VERSION,
  AUTOMATIC_CHECKIN_CREDENTIAL_EXPIRY_BUCKETS,
  AUTOMATIC_CHECKIN_MAX_BODY_BYTES,
  AUTOMATIC_CHECKIN_MONITOR_HEALTH,
  AUTOMATIC_CHECKIN_OUTCOMES,
  AUTOMATIC_CHECKIN_PERMISSION_HEALTH,
  AUTOMATIC_CHECKIN_SCHEMA_VERSION,
  AutomaticCheckinCandidateV1,
  AutomaticCheckinOutcome,
  AutomaticCheckinResponseV1,
  AutomaticEnrollmentStatusV1,
  AutomaticNativeConfigV1,
  AutomaticNativePolicyStatusV1,
  AutomaticTerminalRegionV1,
} from "../contracts/leaderboards";

const UINT32_MAX = 0xffffffff;
const CANDIDATE_ID_PATTERN = /^[A-Za-z0-9_-]{21}[AQgw]$/u;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_IDENTIFIER_BYTES = 128;

const RETRYABLE_OUTCOMES = new Set<AutomaticCheckinOutcome>([
  "history_warming",
  "rate_limited",
  "temporarily_unavailable",
]);

const PRE_AUTH_OUTCOMES = new Set<AutomaticCheckinOutcome>([
  "authentication_failed",
  "invalid_candidate",
  "malformed_payload",
  "payload_too_large",
  "rate_limited",
  "temporarily_unavailable",
  "unsupported_encoding",
  "unsupported_media_type",
]);

const CANDIDATE_BASE_KEYS = [
  "accuracyMillimeters",
  "candidateId",
  "capturedAtMs",
  "kind",
  "latitudeE7",
  "longitudeE7",
  "schemaVersion",
] as const;

export type AutomaticCheckinCandidateJsonError =
  | "malformed_payload"
  | "payload_too_large"
  | "schema_invalid";

export type AutomaticCheckinCandidateJsonResult =
  | { candidate: AutomaticCheckinCandidateV1; ok: true }
  | { error: AutomaticCheckinCandidateJsonError; ok: false };

// narrow plain objects
const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

// read own fields compatibly
const hasOwn = (value: object, key: string): boolean => {
  return Object.prototype.hasOwnProperty.call(value, key);
};

// require an exact key set
const hasExactKeys = (
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = []
): boolean => {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(value);

  // reject missing required keys
  if (!required.every((key) => hasOwn(value, key))) {
    return false;
  }

  // reject unknown keys
  return keys.every((key) => allowed.has(key));
};

// require a safe unsigned integer
const isSafeUnsignedInteger = (value: unknown): value is number => {
  return Number.isSafeInteger(value) && (value as number) >= 0;
};

// require a uint32
const isUint32 = (value: unknown): value is number => {
  return isSafeUnsignedInteger(value) && value <= UINT32_MAX;
};

// require a positive uint32
const isPositiveUint32 = (value: unknown): value is number => {
  return isUint32(value) && value > 0;
};

// reject unpaired UTF-16 surrogates
const hasOnlyUnicodeScalars = (value: string): boolean => {
  // inspect every code unit
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    // skip non-surrogates
    if (codeUnit < 0xd800 || codeUnit > 0xdfff) {
      continue;
    }

    // reject lone low surrogates
    if (codeUnit >= 0xdc00) {
      return false;
    }

    const nextCodeUnit = value.charCodeAt(index + 1);

    // reject lone high surrogates
    if (
      index + 1 >= value.length ||
      nextCodeUnit < 0xdc00 ||
      nextCodeUnit > 0xdfff
    ) {
      return false;
    }

    index += 1;
  }

  return true;
};

// reject control characters
const hasControlCharacter = (value: string): boolean => {
  // inspect every code unit
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);

    // detect ASCII controls
    if (codeUnit <= 0x1f || codeUnit === 0x7f) {
      return true;
    }
  }

  return false;
};

// count canonical UTF-8 bytes
const utf8Bytes = (value: string): Uint8Array => {
  return new TextEncoder().encode(value);
};

// validate bounded wire identifiers
const isIdentifier = (value: unknown): value is string => {
  // reject invalid string structure
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    hasControlCharacter(value) ||
    !hasOnlyUnicodeScalars(value)
  ) {
    return false;
  }

  return utf8Bytes(value).byteLength <= MAX_IDENTIFIER_BYTES;
};

// validate common candidate semantics
const hasValidCandidateBase = (value: Record<string, unknown>): boolean => {
  return (
    value.schemaVersion === AUTOMATIC_CHECKIN_SCHEMA_VERSION &&
    typeof value.candidateId === "string" &&
    CANDIDATE_ID_PATTERN.test(value.candidateId) &&
    isSafeUnsignedInteger(value.capturedAtMs) &&
    Number.isInteger(value.latitudeE7) &&
    (value.latitudeE7 as number) >= -900000000 &&
    (value.latitudeE7 as number) <= 900000000 &&
    Number.isInteger(value.longitudeE7) &&
    (value.longitudeE7 as number) >= -1800000000 &&
    (value.longitudeE7 as number) <= 1800000000 &&
    isUint32(value.accuracyMillimeters)
  );
};

// parse the strict candidate union
export const parseAutomaticCheckinCandidateV1 = (
  value: unknown
): AutomaticCheckinCandidateV1 | null => {
  // require an object discriminator
  if (!isRecord(value) || !hasValidCandidateBase(value)) {
    return null;
  }

  // parse terminal semantics
  if (value.kind === "terminal") {
    const keys = [...CANDIDATE_BASE_KEYS, "configGeneration", "terminalId"];

    // reject mixed or extra fields
    if (
      !hasExactKeys(value, keys) ||
      !isSafeUnsignedInteger(value.configGeneration) ||
      value.configGeneration === 0 ||
      !isIdentifier(value.terminalId)
    ) {
      return null;
    }

    return value as unknown as AutomaticCheckinCandidateV1;
  }

  // parse vessel semantics
  if (value.kind === "vessel") {
    const keys = [...CANDIDATE_BASE_KEYS, "sailingId", "vesselId"];

    // reject mixed or extra fields
    if (
      !hasExactKeys(value, keys) ||
      !isIdentifier(value.sailingId) ||
      !isIdentifier(value.vesselId)
    ) {
      return null;
    }

    return value as unknown as AutomaticCheckinCandidateV1;
  }

  return null;
};

// parse a bounded JSON candidate
export const parseAutomaticCheckinCandidateJsonV1 = (
  payload: string
): AutomaticCheckinCandidateJsonResult => {
  // enforce the decoded endpoint limit
  if (utf8Bytes(payload).byteLength > AUTOMATIC_CHECKIN_MAX_BODY_BYTES) {
    return { error: "payload_too_large", ok: false };
  }

  let value: unknown;

  // isolate malformed JSON
  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    return { error: "malformed_payload", ok: false };
  }

  const candidate = parseAutomaticCheckinCandidateV1(value);

  // reject invalid semantics
  if (!candidate) {
    return { error: "schema_invalid", ok: false };
  }

  return { candidate, ok: true };
};

// parse the fixed response envelope
export const parseAutomaticCheckinResponseV1 = (
  value: unknown
): AutomaticCheckinResponseV1 | null => {
  // require only fixed response fields
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        "credited",
        "disposition",
        "outcome",
        "schemaVersion",
        "serverPolicyGeneration",
      ],
      ["retryAfterSeconds"]
    ) ||
    value.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION ||
    typeof value.credited !== "boolean" ||
    (value.disposition !== "final" && value.disposition !== "retryable") ||
    !AUTOMATIC_CHECKIN_OUTCOMES.includes(
      value.outcome as AutomaticCheckinOutcome
    ) ||
    !(
      value.serverPolicyGeneration === null ||
      isSafeUnsignedInteger(value.serverPolicyGeneration)
    )
  ) {
    return null;
  }

  const outcome = value.outcome as AutomaticCheckinOutcome;
  const retryable = RETRYABLE_OUTCOMES.has(outcome);

  // bind disposition to outcome
  if ((value.disposition === "retryable") !== retryable) {
    return null;
  }

  // bind credited to its sole outcome
  if ((outcome === "credited") !== value.credited) {
    return null;
  }

  // require credited responses to be final
  if (value.credited && value.disposition !== "final") {
    return null;
  }

  // restrict pre-auth policy redaction
  if (
    value.serverPolicyGeneration === null &&
    !PRE_AUTH_OUTCOMES.has(outcome)
  ) {
    return null;
  }

  // restrict retry hints to retryable responses
  if (
    hasOwn(value, "retryAfterSeconds") &&
    (!retryable || !isPositiveUint32(value.retryAfterSeconds))
  ) {
    return null;
  }

  return value as unknown as AutomaticCheckinResponseV1;
};

// parse aggregate enrollment status
export const parseAutomaticEnrollmentStatusV1 = (
  value: unknown
): AutomaticEnrollmentStatusV1 | null => {
  const keys = [
    "capabilityVersion",
    "configGeneration",
    "credentialExpiryBucket",
    "lastOutcome",
    "monitorHealth",
    "pendingCandidateCount",
    "permissionHealth",
    "platform",
    "schemaVersion",
    "serverPolicyGeneration",
  ];

  // require the detail-free aggregate shape
  if (
    !isRecord(value) ||
    !hasExactKeys(value, keys) ||
    value.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION ||
    value.capabilityVersion !== AUTOMATIC_CHECKIN_CAPABILITY_VERSION ||
    !(
      value.configGeneration === null ||
      (isSafeUnsignedInteger(value.configGeneration) &&
        value.configGeneration > 0)
    ) ||
    !isSafeUnsignedInteger(value.serverPolicyGeneration) ||
    !isUint32(value.pendingCandidateCount) ||
    (value.platform !== "android" && value.platform !== "ios") ||
    !AUTOMATIC_CHECKIN_PERMISSION_HEALTH.includes(
      value.permissionHealth as AutomaticEnrollmentStatusV1["permissionHealth"]
    ) ||
    !AUTOMATIC_CHECKIN_MONITOR_HEALTH.includes(
      value.monitorHealth as AutomaticEnrollmentStatusV1["monitorHealth"]
    ) ||
    !AUTOMATIC_CHECKIN_CREDENTIAL_EXPIRY_BUCKETS.includes(
      value.credentialExpiryBucket as AutomaticEnrollmentStatusV1["credentialExpiryBucket"]
    ) ||
    !(
      value.lastOutcome === null ||
      AUTOMATIC_CHECKIN_AGGREGATE_OUTCOMES.includes(
        value.lastOutcome as AutomaticEnrollmentStatusV1["lastOutcome"] & string
      )
    )
  ) {
    return null;
  }

  return value as unknown as AutomaticEnrollmentStatusV1;
};

/** parses one fixed server policy status */
export const parseAutomaticNativePolicyStatusV1 = (
  value: unknown
): AutomaticNativePolicyStatusV1 | null => {
  // require the exact detail-free status shape
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "automaticEnabled",
      "credentialExpiryBucket",
      "rotateRecommended",
      "schemaVersion",
      "serverPolicyGeneration",
    ]) ||
    value.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION ||
    typeof value.automaticEnabled !== "boolean" ||
    typeof value.rotateRecommended !== "boolean" ||
    !isSafeUnsignedInteger(value.serverPolicyGeneration) ||
    !AUTOMATIC_CHECKIN_CREDENTIAL_EXPIRY_BUCKETS.includes(
      value.credentialExpiryBucket as AutomaticNativePolicyStatusV1["credentialExpiryBucket"]
    )
  ) {
    return null;
  }

  return value as unknown as AutomaticNativePolicyStatusV1;
};

// validate a terminal region
const isAutomaticTerminalRegionV1 = (
  value: unknown,
  configGeneration?: number
): value is AutomaticTerminalRegionV1 => {
  const region = value as Record<string, unknown>;

  // require scaled immutable geometry
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "configGeneration",
      "latitudeE7",
      "longitudeE7",
      "radiusMillimeters",
      "terminalId",
    ]) ||
    !isSafeUnsignedInteger(value.configGeneration) ||
    value.configGeneration === 0 ||
    (configGeneration !== undefined &&
      value.configGeneration !== configGeneration) ||
    !Number.isInteger(region.latitudeE7) ||
    (region.latitudeE7 as number) < -900000000 ||
    (region.latitudeE7 as number) > 900000000 ||
    !Number.isInteger(region.longitudeE7) ||
    (region.longitudeE7 as number) < -1800000000 ||
    (region.longitudeE7 as number) > 1800000000 ||
    !isPositiveUint32(value.radiusMillimeters) ||
    !isIdentifier(value.terminalId)
  ) {
    return false;
  }

  return true;
};

// compare identifiers by UTF-8 bytes
const compareUtf8 = (left: string, right: string): number => {
  const leftBytes = utf8Bytes(left);
  const rightBytes = utf8Bytes(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);

  // compare the shared prefix
  for (let index = 0; index < sharedLength; index += 1) {
    // return the first differing byte
    if (leftBytes[index] !== rightBytes[index]) {
      return leftBytes[index] - rightBytes[index];
    }
  }

  return leftBytes.length - rightBytes.length;
};

// validate exact native endpoint URLs
const isNativeEndpointUrl = (value: unknown, path: string): value is string => {
  // require a string URL
  if (typeof value !== "string") {
    return false;
  }

  let url: URL;

  // reject malformed URLs
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return (
    url.protocol === "https:" &&
    url.pathname === path &&
    url.search === "" &&
    url.hash === "" &&
    url.username === "" &&
    url.password === ""
  );
};

// parse native configuration
const parseAutomaticNativeConfigStructureV1 = (
  value: unknown,
  expectedOrigin: string
): AutomaticNativeConfigV1 | null => {
  const keys = [
    "configGeneration",
    "contentHash",
    "detectors",
    "generatedAtMs",
    "parameters",
    "regions",
    "schemaVersion",
    "serverPolicyGeneration",
    "serverTimeMs",
    "urls",
  ];

  // require the fixed top-level shape
  if (
    !isRecord(value) ||
    !hasExactKeys(value, keys) ||
    value.schemaVersion !== AUTOMATIC_CHECKIN_SCHEMA_VERSION ||
    !isSafeUnsignedInteger(value.configGeneration) ||
    value.configGeneration === 0 ||
    typeof value.contentHash !== "string" ||
    !SHA256_HEX_PATTERN.test(value.contentHash) ||
    !isSafeUnsignedInteger(value.generatedAtMs) ||
    !isSafeUnsignedInteger(value.serverTimeMs) ||
    !isSafeUnsignedInteger(value.serverPolicyGeneration) ||
    !isRecord(value.detectors) ||
    !hasExactKeys(value.detectors, ["terminalEnabled", "vesselEnabled"]) ||
    typeof value.detectors.terminalEnabled !== "boolean" ||
    typeof value.detectors.vesselEnabled !== "boolean" ||
    !isRecord(value.parameters) ||
    !hasExactKeys(value.parameters, [
      "candidateRetentionMs",
      "fleetContextMaxAgeMs",
      "futureToleranceMs",
      "maxLocationAccuracyMillimeters",
      "maxPendingCandidates",
    ]) ||
    value.parameters.candidateRetentionMs !==
      AUTOMATIC_CHECKIN_CANDIDATE_RETENTION_MS ||
    !isPositiveUint32(value.parameters.fleetContextMaxAgeMs) ||
    !isUint32(value.parameters.futureToleranceMs) ||
    !isPositiveUint32(value.parameters.maxLocationAccuracyMillimeters) ||
    !isPositiveUint32(value.parameters.maxPendingCandidates) ||
    !isRecord(value.urls) ||
    !hasExactKeys(value.urls, [
      "candidates",
      "config",
      "enrollment",
      "status",
    ]) ||
    !isNativeEndpointUrl(
      value.urls.candidates,
      "/api/leaderboards/native/candidates"
    ) ||
    !isNativeEndpointUrl(
      value.urls.config,
      "/api/leaderboards/native/config"
    ) ||
    !isNativeEndpointUrl(
      value.urls.enrollment,
      "/api/leaderboards/native/enrollment"
    ) ||
    !isNativeEndpointUrl(
      value.urls.status,
      "/api/leaderboards/native/status"
    ) ||
    !Array.isArray(value.regions) ||
    value.regions.length === 0
  ) {
    return null;
  }

  let trustedOrigin: string;

  // require an explicit trusted HTTPS origin
  try {
    const trustedUrl = new URL(expectedOrigin);

    // reject path-bearing or credential-bearing origins
    if (
      trustedUrl.protocol !== "https:" ||
      trustedUrl.pathname !== "/" ||
      trustedUrl.search !== "" ||
      trustedUrl.hash !== "" ||
      trustedUrl.username !== "" ||
      trustedUrl.password !== ""
    ) {
      return null;
    }

    trustedOrigin = trustedUrl.origin;
  } catch {
    return null;
  }

  const { regions } = value;
  const nativeOrigins = new Set(
    [
      value.urls.candidates,
      value.urls.config,
      value.urls.enrollment,
      value.urls.status,
    ].map((url) => new URL(url).origin)
  );
  const terminalIds = new Set<string>();
  let previousTerminalId: string | null = null;

  // require one trusted production origin
  if (nativeOrigins.size !== 1 || !nativeOrigins.has(trustedOrigin)) {
    return null;
  }

  // validate complete ordered regions
  for (let index = 0; index < regions.length; index += 1) {
    const region = regions[index];

    // reject invalid or duplicate regions
    if (
      !isAutomaticTerminalRegionV1(region, value.configGeneration) ||
      terminalIds.has(region.terminalId)
    ) {
      return null;
    }

    // require deterministic ordering
    if (
      previousTerminalId !== null &&
      compareUtf8(previousTerminalId, region.terminalId) >= 0
    ) {
      return null;
    }

    terminalIds.add(region.terminalId);
    previousTerminalId = region.terminalId;
  }

  return value as unknown as AutomaticNativeConfigV1;
};

// append a big-endian uint32
const appendUint32 = (target: number[], value: number): void => {
  target.push(
    Math.floor(value / 0x1000000) % 0x100,
    Math.floor(value / 0x10000) % 0x100,
    Math.floor(value / 0x100) % 0x100,
    value % 0x100
  );
};

// append a big-endian int32
const appendInt32 = (target: number[], value: number): void => {
  appendUint32(target, value < 0 ? value + 0x100000000 : value);
};

// append a safe big-endian uint64
const appendUint64 = (target: number[], value: number): void => {
  const high = Math.floor(value / 0x100000000);
  const low = value - high * 0x100000000;
  appendUint32(target, high);
  appendUint32(target, low);
};

// append length-prefixed UTF-8
const appendString = (target: number[], value: string): void => {
  const bytes = utf8Bytes(value);
  appendUint32(target, bytes.length);
  target.push(...bytes);
};

// serialize candidate semantics
export const canonicalAutomaticCheckinCandidateBytesV1 = (
  candidate: AutomaticCheckinCandidateV1
): Uint8Array => {
  const parsed = parseAutomaticCheckinCandidateV1(candidate);

  // reject unvalidated semantics
  if (!parsed) {
    throw new Error("invalid automatic check-in candidate");
  }

  const bytes: number[] = [AUTOMATIC_CHECKIN_SCHEMA_VERSION];
  appendString(bytes, parsed.kind);
  appendString(bytes, parsed.candidateId);
  appendUint64(bytes, parsed.capturedAtMs);
  appendInt32(bytes, parsed.latitudeE7);
  appendInt32(bytes, parsed.longitudeE7);
  appendUint32(bytes, parsed.accuracyMillimeters);

  // append terminal-only semantics
  if (parsed.kind === "terminal") {
    appendString(bytes, parsed.terminalId);
    appendUint64(bytes, parsed.configGeneration);
  } else {
    appendString(bytes, parsed.vesselId);
    appendString(bytes, parsed.sailingId);
  }

  return Uint8Array.from(bytes);
};

// encode bytes as lower-case hexadecimal
export const bytesToLowerHex = (bytes: Uint8Array): string => {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    ""
  );
};

// hash bytes with SHA-256
const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>
  );
  return bytesToLowerHex(new Uint8Array(digest));
};

// hash canonical candidate semantics
export const payloadDigestV1 = (
  candidate: AutomaticCheckinCandidateV1
): Promise<string> => {
  return sha256Hex(canonicalAutomaticCheckinCandidateBytesV1(candidate));
};

// serialize generation-independent region content
export const canonicalAutomaticTerminalRegionBytesV1 = (
  regions: readonly AutomaticTerminalRegionV1[]
): Uint8Array => {
  const seen = new Set<string>();
  let configGeneration: number | null = null;

  // reject an incomplete region set
  if (regions.length === 0) {
    throw new Error("invalid automatic terminal regions");
  }

  // reject invalid or duplicate geometry
  for (const region of regions) {
    // require independently valid rows
    if (!isAutomaticTerminalRegionV1(region) || seen.has(region.terminalId)) {
      throw new Error("invalid automatic terminal regions");
    }

    const { configGeneration: regionGeneration } = region;

    // reject mixed immutable generations
    if (configGeneration !== null && regionGeneration !== configGeneration) {
      throw new Error("invalid automatic terminal regions");
    }

    seen.add(region.terminalId);
    configGeneration = regionGeneration;
  }

  const canonical = [...regions]
    .sort((left, right) => compareUtf8(left.terminalId, right.terminalId))
    .map(({ latitudeE7, longitudeE7, radiusMillimeters, terminalId }) => ({
      latitudeE7,
      longitudeE7,
      radiusMillimeters,
      terminalId,
    }));
  return utf8Bytes(JSON.stringify(canonical));
};

// hash generation-independent region content
export const automaticTerminalRegionContentHashV1 = (
  regions: readonly AutomaticTerminalRegionV1[]
): Promise<string> => {
  return sha256Hex(canonicalAutomaticTerminalRegionBytesV1(regions));
};

// verify native configuration content
export const hasValidAutomaticNativeConfigContentHashV1 = async (
  config: AutomaticNativeConfigV1
): Promise<boolean> => {
  return (
    (await automaticTerminalRegionContentHashV1(config.regions)) ===
    config.contentHash
  );
};

// parse and verify activation-ready native configuration
export const parseAutomaticNativeConfigV1 = async (
  value: unknown,
  expectedOrigin: string
): Promise<AutomaticNativeConfigV1 | null> => {
  const config = parseAutomaticNativeConfigStructureV1(value, expectedOrigin);

  // reject malformed structure or trusted-origin mismatch
  if (!config) {
    return null;
  }

  // verify canonical content
  try {
    // reject content substitution
    if (!(await hasValidAutomaticNativeConfigContentHashV1(config))) {
      return null;
    }
  } catch {
    // fail closed without hash support
    return null;
  }

  return config;
};
