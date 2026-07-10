import {
  OTA_CHANNELS,
  OtaChannel,
  OtaRelease,
  OtaUpdateManifest,
  OtaUpdateRequest,
} from "shared/contracts/ota";

const OTA_RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;
const SHA256_PATTERN = /^[a-f\d]{64}$/iu;
const SEMVER_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u;

interface OtaReleaseIndex {
  releases: unknown;
}

interface OtaManifestRequest extends OtaUpdateRequest {
  defaultChannel?: OtaChannel;
}

let cachedReleases: OtaRelease[] | undefined;
let cachedReleasesUrl: string | undefined;
let cachedUntil = 0;

const noUpdateManifest: OtaUpdateManifest = {
  error: "no_new_version_available",
  kind: "up_to_date",
  message: "No new version available",
};

const REQUIRED_REQUEST_STRING_FIELDS = [
  "app_id",
  "device_id",
  "plugin_version",
  "version_build",
  "version_code",
  "version_os",
] as const;

// update all cache values synchronously
const cacheOtaReleases = (
  releases: OtaRelease[],
  releasesUrl: string,
  expiresAt: number
): void => {
  cachedReleases = releases;
  cachedReleasesUrl = releasesUrl;
  cachedUntil = expiresAt;
};

// validate configured rollout channels
const isOtaChannel = (value: unknown): value is OtaChannel => {
  return (
    typeof value === "string" && OTA_CHANNELS.includes(value as OtaChannel)
  );
};

// validate a public immutable bundle URL
const isImmutableBundleUrl = (value: unknown): value is string => {
  // string guard
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
};

// validate one release record from the public index
const parseOtaRelease = (value: unknown): OtaRelease | undefined => {
  // object guard
  if (value === null || typeof value !== "object") {
    return;
  }
  const { channel, checksum, url, version } = value as Record<string, unknown>;
  // field guard
  if (
    (channel !== "development" &&
      channel !== "staging" &&
      channel !== "production") ||
    typeof checksum !== "string" ||
    !SHA256_PATTERN.test(checksum) ||
    !isImmutableBundleUrl(url) ||
    typeof version !== "string" ||
    !SEMVER_PATTERN.test(version)
  ) {
    return;
  }
  return {
    channel,
    checksum,
    url,
    version: version as OtaRelease["version"],
  };
};

// validate the complete release index before caching it
const parseOtaReleaseIndex = (value: unknown): OtaRelease[] | undefined => {
  // index guard
  if (value === null || typeof value !== "object") {
    return;
  }
  const { releases } = value as OtaReleaseIndex;
  // releases array guard
  if (!Array.isArray(releases)) {
    return;
  }
  const parsedReleases = releases.map(parseOtaRelease);
  // invalid record guard
  if (parsedReleases.some((release) => !release)) {
    return;
  }
  const validReleases = parsedReleases as OtaRelease[];
  const channels = new Set(validReleases.map(({ channel }) => channel));
  // duplicate channel guard
  if (channels.size !== validReleases.length) {
    return;
  }
  return validReleases;
};

// validate the updater's required manifest request fields
const parseOtaManifestRequest = (
  value: unknown
): OtaManifestRequest | undefined => {
  // object guard
  if (value === null || typeof value !== "object") {
    return;
  }
  const request = value as Record<string, unknown>;
  // required string guard
  if (
    REQUIRED_REQUEST_STRING_FIELDS.some(
      (field) => typeof request[field] !== "string"
    )
  ) {
    return;
  }
  // platform and boolean guard
  if (
    request.platform !== "android" ||
    typeof request.is_emulator !== "boolean" ||
    typeof request.is_prod !== "boolean"
  ) {
    return;
  }
  // optional identifier guard
  if (
    typeof request.custom_id !== "undefined" &&
    typeof request.custom_id !== "string"
  ) {
    return;
  }
  // channel guard
  if (
    typeof request.defaultChannel !== "undefined" &&
    !isOtaChannel(request.defaultChannel)
  ) {
    return;
  }
  // version guard
  if (
    request.version_name !== "builtin" &&
    (typeof request.version_name !== "string" ||
      !SEMVER_PATTERN.test(request.version_name))
  ) {
    return;
  }
  return request as unknown as OtaManifestRequest;
};

// compare semantic versions without accepting downgrades
const isReleaseNewer = (release: string, current: string): boolean => {
  // builtin guard
  if (current === "builtin") {
    return true;
  }
  const releaseWithoutBuild = release.split("+")[0];
  const currentWithoutBuild = current.split("+")[0];
  const releaseSeparator = releaseWithoutBuild.indexOf("-");
  const currentSeparator = currentWithoutBuild.indexOf("-");
  const releaseCore = releaseWithoutBuild.slice(
    0,
    releaseSeparator === -1 ? undefined : releaseSeparator
  );
  const currentCore = currentWithoutBuild.slice(
    0,
    currentSeparator === -1 ? undefined : currentSeparator
  );
  const releasePreRelease =
    releaseSeparator === -1
      ? ""
      : releaseWithoutBuild.slice(releaseSeparator + 1);
  const currentPreRelease =
    currentSeparator === -1
      ? ""
      : currentWithoutBuild.slice(currentSeparator + 1);
  const releaseParts = releaseCore.split(".").map(Number);
  const currentParts = currentCore.split(".").map(Number);
  // numeric version comparison
  for (let index = 0; index < releaseParts.length; index += 1) {
    if (releaseParts[index] !== currentParts[index]) {
      return releaseParts[index] > currentParts[index];
    }
  }
  // stable releases supersede prereleases
  if (!releasePreRelease || !currentPreRelease) {
    return Boolean(!releasePreRelease && currentPreRelease);
  }
  const releaseIdentifiers = releasePreRelease.split(".");
  const currentIdentifiers = currentPreRelease.split(".");
  // prerelease identifier comparison
  for (
    let index = 0;
    index < Math.max(releaseIdentifiers.length, currentIdentifiers.length);
    index += 1
  ) {
    const releaseIdentifier = releaseIdentifiers[index];
    const currentIdentifier = currentIdentifiers[index];
    // longer prerelease guard
    if (typeof releaseIdentifier === "undefined") {
      return false;
    }
    if (typeof currentIdentifier === "undefined") {
      return true;
    }
    if (releaseIdentifier === currentIdentifier) {
      continue;
    }
    const releaseNumber = /^\d+$/u.test(releaseIdentifier);
    const currentNumber = /^\d+$/u.test(currentIdentifier);
    // numeric prereleases sort before nonnumeric identifiers
    if (releaseNumber !== currentNumber) {
      return releaseNumber;
    }
    if (releaseNumber && currentNumber) {
      return Number(releaseIdentifier) > Number(currentIdentifier);
    }
    return releaseIdentifier > currentIdentifier;
  }
  return false;
};

// select a validated request channel or configured fallback
const getOtaChannel = (request: OtaManifestRequest): OtaChannel | undefined => {
  return (
    request.defaultChannel ??
    (isOtaChannel(process.env.OTA_DEFAULT_CHANNEL)
      ? process.env.OTA_DEFAULT_CHANNEL
      : undefined)
  );
};

// fetch and cache the unsigned public release index
export const getCachedOtaReleases = async (): Promise<OtaRelease[]> => {
  const releasesUrl = process.env.OTA_RELEASES_URL;
  const now = Date.now();
  // fresh cache guard
  if (
    cachedReleases &&
    cachedReleasesUrl === releasesUrl &&
    cachedUntil > now
  ) {
    return cachedReleases;
  }
  // configuration guard
  if (!releasesUrl) {
    throw new Error("OTA releases URL is not configured");
  }
  const response = await fetch(releasesUrl, {
    headers: { Accept: "application/json" },
  });
  // response guard
  if (!response.ok) {
    throw new Error("OTA release index request failed");
  }
  const releases = parseOtaReleaseIndex(await response.json());
  // index data guard
  if (!releases) {
    throw new Error("OTA release index is invalid");
  }
  cacheOtaReleases(releases, releasesUrl, now + OTA_RELEASE_CACHE_TTL_MS);
  return releases;
};

// resolve a safe manifest response without leaking configuration failures
export const getOtaUpdateManifest = async (
  value: unknown
): Promise<OtaUpdateManifest> => {
  const request = parseOtaManifestRequest(value);
  // invalid request guard
  if (!request) {
    return noUpdateManifest;
  }
  const channel = getOtaChannel(request);
  // unconfigured channel guard
  if (!channel) {
    return noUpdateManifest;
  }
  try {
    const release = (await getCachedOtaReleases()).find(
      (candidate) => candidate.channel === channel
    );
    // unavailable or non-new release guard
    if (!release || !isReleaseNewer(release.version, request.version_name)) {
      return noUpdateManifest;
    }
    return release;
  } catch {
    // preserve the current bundle on upstream failures
    return noUpdateManifest;
  }
};
