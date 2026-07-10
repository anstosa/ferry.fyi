import {
  OTA_CHANNELS,
  OtaChannel,
  OtaClientConfig,
  OtaClientEnvironment,
} from "../contracts/ota";

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
