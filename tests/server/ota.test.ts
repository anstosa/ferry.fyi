import { describe, expect, it } from "vitest";

import { parseOtaManifestRequest } from "../../server/lib/ota";

// complete native updater payload
const createManifestRequest = (platform: "android" | "ios") => ({
  app_id: "fyi.ferry",
  device_id: "device-id",
  is_emulator: false,
  is_prod: true,
  platform,
  plugin_version: "8.0.0",
  version_build: "42",
  version_code: "42",
  version_name: "builtin",
  version_os: "18.0",
});

// native OTA request validation
describe("parseOtaManifestRequest", () => {
  // accept the iOS updater payload
  it("accepts iOS updater requests", () => {
    expect(parseOtaManifestRequest(createManifestRequest("ios"))).toMatchObject({
      platform: "ios",
    });
  });

  // reject unsupported platform values
  it("rejects unsupported platforms", () => {
    expect(
      parseOtaManifestRequest({
        ...createManifestRequest("android"),
        platform: "windows",
      })
    ).toBeUndefined();
  });
});
