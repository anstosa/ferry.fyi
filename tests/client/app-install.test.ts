import { describe, expect, it, vi } from "vitest";

import {
  APPLE_APP_STORE_ID,
  APPLE_APP_STORE_URL,
  getInstallStoreUrl,
  getInstallPlatform,
  GOOGLE_PLAY_URL,
  redirectToInstallStore,
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
    expect(
      getInstallPlatform(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"
      )
    ).toBe("ios");
  });

  it("routes iPadOS desktop-class browsers to the App Store", () => {
    expect(
      getInstallPlatform(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15",
        5
      )
    ).toBe("ios");
  });

  it("uses website installation guidance for other browsers", () => {
    expect(getInstallPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("web");
  });

  it("maps mobile platforms to their published store listings", () => {
    expect(getInstallStoreUrl("android")).toBe(GOOGLE_PLAY_URL);
    expect(getInstallStoreUrl("ios")).toBe(APPLE_APP_STORE_URL);
    expect(getInstallStoreUrl("web")).toBeNull();
  });

  it("redirects only mobile platforms", () => {
    const redirect = vi.fn();

    expect(redirectToInstallStore("android", redirect)).toBe(true);
    expect(redirect).toHaveBeenCalledWith(GOOGLE_PLAY_URL);
    redirect.mockClear();

    expect(redirectToInstallStore("web", redirect)).toBe(false);
    expect(redirect).not.toHaveBeenCalled();
  });
});
