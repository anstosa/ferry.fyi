import {
  OTA_CHANNELS,
  type OtaAppVersion,
  OtaChannel,
  OtaClientConfig,
  OtaClientEnvironment,
} from "../contracts/ota";

// share canonical native prefixes with composite publication metadata patterns
export const OTA_APP_VERSION_PATTERN_SOURCE =
  "(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)";
const APP_VERSION_PATTERN = new RegExp(
  `^${OTA_APP_VERSION_PATTERN_SOURCE}$`,
  "u"
);

// validate the shared two-component native app grammar
export const isOtaAppVersion = (value: unknown): value is OtaAppVersion => {
  return typeof value === "string" && APP_VERSION_PATTERN.test(value);
};

// validate staged channel
export const isOtaChannel = (value: string): value is OtaChannel => {
  return OTA_CHANNELS.includes(value as OtaChannel);
};

// require a secure manifest endpoint
const isSecureManifestUrl = (value: string): boolean => {
  return /^https:\/\/[^/\s?#]+(?:\/[^\s]*)?$/u.test(value);
};

// read client-safe OTA configuration
export const getOtaClientConfig = (
  environment: OtaClientEnvironment
): OtaClientConfig | null => {
  const channel = environment.VITE_OTA_CHANNEL;
  const manifestUrl = environment.VITE_OTA_MANIFEST_URL;

  // disable incomplete configuration
  if (!channel || !manifestUrl) {
    return null;
  }

  // reject unsupported rollout channels
  if (!isOtaChannel(channel)) {
    return null;
  }

  // reject insecure update endpoints
  if (!isSecureManifestUrl(manifestUrl)) {
    return null;
  }

  return { channel, manifestUrl };
};
