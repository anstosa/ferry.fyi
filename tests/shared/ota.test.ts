import { describe, expect, it } from "vitest";

import {
  OTA_CLIENT_ENV_KEYS,
  OTA_INFRA_ENV_KEYS,
  OTA_PUBLISH_ENV_KEYS,
  OTA_SERVER_ENV_KEYS,
  OtaAvailableUpdate,
  OtaNoUpdate,
  OtaUpdateRequest,
} from "../../shared/contracts/ota";
import {
  getOtaClientConfig,
  isOtaAppVersion,
  isOtaChannel,
} from "../../shared/lib/ota";

// OTA contract and staged configuration
describe("OTA contract and configuration", () => {
  // share canonical native prefixes across request and publication boundaries
  it.each(["0.0", "3.6", "12.34"])(
    "accepts canonical native app versions: %s",
    (version) => {
      expect(isOtaAppVersion(version)).toBe(true);
    }
  );

  // reject incomplete, decorated and non-string native prefixes
  it.each([
    "3",
    "03.6",
    "3.06",
    "3.6.0",
    "3.6-beta",
    "3.6+source",
    " 3.6",
    "3.6\n",
    null,
    3.6,
  ])("rejects noncanonical native app versions: %s", (version) => {
    expect(isOtaAppVersion(version)).toBe(false);
  });

  // capgo request payload
  it("models the custom-backend POST metadata", () => {
    const request: OtaUpdateRequest = {
      app_id: "fyi.ferry",
      device_id: "device-id",
      is_emulator: false,
      is_prod: true,
      platform: "android",
      plugin_version: "8.0.0",
      version_build: "42",
      version_code: "42",
      version_name: "builtin",
      version_os: "16",
    };

    expect(request.app_id).toBe("fyi.ferry");
  });

  // native requests report the published app prefix before an OTA is active
  it("models a two-component native app version", () => {
    const request: OtaUpdateRequest = {
      app_id: "fyi.ferry",
      device_id: "device-id",
      is_emulator: false,
      is_prod: true,
      platform: "android",
      plugin_version: "8.50.2",
      version_build: "3.6",
      version_code: "262451507",
      version_name: "3.6",
      version_os: "17",
    };

    expect(request.version_name).toBe("3.6");
  });

  // iOS custom-backend metadata
  it("models iOS updater requests", () => {
    const request: OtaUpdateRequest = {
      app_id: "fyi.ferry",
      device_id: "device-id",
      is_emulator: false,
      is_prod: true,
      platform: "ios",
      plugin_version: "8.0.0",
      version_build: "42",
      version_code: "42",
      version_name: "builtin",
      version_os: "18.0",
    };

    expect(request.platform).toBe("ios");
  });

  // immutable bundle response
  it("models an available update with a semver release and checksum", () => {
    const response: OtaAvailableUpdate = {
      checksum:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      url: "https://updates.ferry.fyi/bundles/1.2.3.zip",
      version: "1.2.3",
    };

    expect(response.url).toContain("/bundles/1.2.3.zip");
  });

  // no-update response
  it("models a no-update response without bundle fields", () => {
    const response: OtaNoUpdate = { message: "No update available" };

    expect(response.message).toBe("No update available");
  });

  // staged channel validation
  it("accepts only the defined release channels", () => {
    expect(isOtaChannel("staging")).toBe(true);
    expect(isOtaChannel("preview")).toBe(false);
  });

  // complete client config
  it("returns only complete secure client OTA configuration", () => {
    expect(
      getOtaClientConfig({
        VITE_OTA_CHANNEL: "staging",
        VITE_OTA_MANIFEST_URL: "https://ferry.fyi/api/ota/manifest",
      })
    ).toEqual({
      channel: "staging",
      manifestUrl: "https://ferry.fyi/api/ota/manifest",
    });
  });

  // unsafe client config
  it("disables incomplete, unknown, and insecure client OTA configuration", () => {
    expect(getOtaClientConfig({ VITE_OTA_CHANNEL: "staging" })).toBeNull();
    expect(
      getOtaClientConfig({
        VITE_OTA_CHANNEL: "preview",
        VITE_OTA_MANIFEST_URL: "https://ferry.fyi/api/ota/manifest",
      })
    ).toBeNull();
    expect(
      getOtaClientConfig({
        VITE_OTA_CHANNEL: "staging",
        VITE_OTA_MANIFEST_URL: "http://localhost:4040/api/ota/manifest",
      })
    ).toBeNull();
  });

  // environment visibility boundary
  it("keeps client exposure separate from server, publishing, and infrastructure", () => {
    expect(OTA_CLIENT_ENV_KEYS).toEqual([
      "VITE_OTA_CHANNEL",
      "VITE_OTA_MANIFEST_URL",
    ]);
    expect(OTA_SERVER_ENV_KEYS).toEqual([
      "OTA_DEFAULT_CHANNEL",
      "OTA_RELEASES_BUCKET",
    ]);
    expect(OTA_PUBLISH_ENV_KEYS).toEqual([
      "OTA_CHANNEL",
      "OTA_RELEASE_VERSION",
    ]);
    expect(OTA_INFRA_ENV_KEYS).toEqual([
      "OTA_BUCKET_NAME",
      "OTA_DISTRIBUTION_DOMAIN",
    ]);
  });
});
