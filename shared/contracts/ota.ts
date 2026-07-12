export const OTA_CHANNELS = ["development", "staging", "production"] as const;

export type OtaChannel = (typeof OTA_CHANNELS)[number];

export type OtaPlatform = "android" | "ios";

export type OtaSemverVersion =
  | `${number}.${number}.${number}`
  | `${number}.${number}.${number}-${string}`
  | `${number}.${number}.${number}+${string}`
  | `${number}.${number}.${number}-${string}+${string}`;

export type OtaSha256Checksum = string;

export type OtaImmutableBundleUrl = string;

export interface OtaUpdateRequest {
  app_id: string;
  custom_id?: string;
  device_id: string;
  is_emulator: boolean;
  is_prod: boolean;
  platform: OtaPlatform;
  plugin_version: string;
  version_build: string;
  version_code: string;
  version_name: "builtin" | OtaSemverVersion;
  version_os: string;
}

export interface OtaAvailableUpdate {
  checksum: OtaSha256Checksum;
  error?: never;
  message?: string;
  url: OtaImmutableBundleUrl;
  version: OtaSemverVersion;
}

export interface OtaNoUpdate {
  checksum?: never;
  error: "no_new_version_available";
  kind: "up_to_date";
  message: string;
  url?: never;
  version?: never;
}

export type OtaUpdateManifest = OtaAvailableUpdate | OtaNoUpdate;

export interface OtaRelease {
  channel: OtaChannel;
  checksum: OtaSha256Checksum;
  url: OtaImmutableBundleUrl;
  version: OtaSemverVersion;
}

export const OTA_CLIENT_ENV_KEYS = [
  "VITE_OTA_CHANNEL",
  "VITE_OTA_MANIFEST_URL",
] as const;

export type OtaClientEnvKey = (typeof OTA_CLIENT_ENV_KEYS)[number];

export type OtaClientEnvironment = Partial<
  Record<OtaClientEnvKey, string | undefined>
>;

export const OTA_SERVER_ENV_KEYS = [
  "OTA_DEFAULT_CHANNEL",
  "OTA_RELEASES_BUCKET",
] as const;

export const OTA_PUBLISH_ENV_KEYS = [
  "OTA_CHANNEL",
  "OTA_RELEASE_VERSION",
] as const;

export const OTA_INFRA_ENV_KEYS = [
  "OTA_BUCKET_NAME",
  "OTA_DISTRIBUTION_DOMAIN",
] as const;

export interface OtaClientConfig {
  channel: OtaChannel;
  manifestUrl: string;
}
