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
  // compare native marketing versions as zero-patch semantic versions
  it.each(["android", "ios"] as const)(
    "normalizes the native version on %s without calling it built-in",
    (platform) => {
      const request = {
        ...createManifestRequest(platform),
        version_build: "3.6",
        version_name: "3.6",
      };
      expect(parseOtaManifestRequest(request)).toMatchObject({
        platform,
        version_build: "3.6",
        version_name: "3.6.0",
      });
      expect(request.version_name).toBe("3.6");
    }
  );

  // normalization does not depend on a built-in bundle heuristic
  it("compares any valid two-part current version normally", () => {
    expect(
      parseOtaManifestRequest({
        ...createManifestRequest("android"),
        version_build: "3.6",
        version_name: "3.7",
      })
    ).toMatchObject({ version_name: "3.7.0" });
  });

  // malformed marketing versions must not bypass validation
  it.each(["03.6", "3.06", "3.6-beta", "broken", null, 3.6])(
    "rejects malformed current version %s",
    (version_name) => {
      expect(
        parseOtaManifestRequest({
          ...createManifestRequest("android"),
          version_name,
        })
      ).toBeUndefined();
    }
  );

  // accept the iOS updater payload
  it("accepts iOS updater requests", () => {
    expect(parseOtaManifestRequest(createManifestRequest("ios"))).toMatchObject(
      {
        platform: "ios",
      }
    );
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
