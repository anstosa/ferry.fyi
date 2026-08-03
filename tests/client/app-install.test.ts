import { describe, expect, it } from "vitest";

import {
  APPLE_APP_STORE_ID,
  APPLE_APP_STORE_URL,
  getInstallPlatform,
} from "../../client/lib/appInstall";

describe("getInstallPlatform", () => {
  it("uses the published iOS App Store listing", () => {
    expect(APPLE_APP_STORE_ID).toBe("6790176506");
    expect(APPLE_APP_STORE_URL).toBe(
      "https://apps.apple.com/us/app/ferry-fyi/id6790176506"
    );
  });

  it("routes Android browsers to Google Play", () => {
    expect(getInstallPlatform("Mozilla/5.0 (Linux; Android 15; Pixel 9)")).toBe(
      "android"
    );
  });

  it("routes Apple mobile browsers to home-screen instructions", () => {
    expect(getInstallPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")).toBe(
      "ios"
    );
  });

  it("uses website installation guidance for other browsers", () => {
    expect(getInstallPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("web");
  });
});
