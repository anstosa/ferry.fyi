import { describe, expect, it, vi } from "vitest";

import {
  checkForNativeAppUpdate,
  NATIVE_APP_UPDATE_REPROMPT_MS,
  openNativeAppStore,
  shouldPromptForNativeAppUpdate,
} from "../../client/lib/nativeAppUpdate";

const info = {
  currentVersionCode: "20",
  currentVersionName: "2.8",
  updateAvailability: 2,
};

describe("native app update store integration", () => {
  it("maps an available Android version code", async () => {
    const getAppUpdateInfo = vi.fn().mockResolvedValue({
      ...info,
      availableVersionCode: "21",
    });

    await expect(
      checkForNativeAppUpdate({
        loadPlugin: async () => ({
          getAppUpdateInfo,
          openAppStore: vi.fn(),
        }),
        platform: "android",
      })
    ).resolves.toEqual({
      availableVersion: "21",
      currentVersion: "20",
      platform: "android",
      versionKey: "android:21",
    });
    expect(getAppUpdateInfo).toHaveBeenCalledWith(undefined);
  });

  it("uses the US storefront and version names on iOS", async () => {
    const getAppUpdateInfo = vi.fn().mockResolvedValue({
      ...info,
      availableVersionName: "2.9",
    });

    await expect(
      checkForNativeAppUpdate({
        loadPlugin: async () => ({
          getAppUpdateInfo,
          openAppStore: vi.fn(),
        }),
        platform: "ios",
      })
    ).resolves.toEqual({
      availableVersion: "2.9",
      currentVersion: "2.8",
      platform: "ios",
      versionKey: "ios:2.9",
    });
    expect(getAppUpdateInfo).toHaveBeenCalledWith({ country: "US" });
  });

  it("ignores missing and unavailable store versions", async () => {
    const getAppUpdateInfo = vi
      .fn()
      .mockResolvedValueOnce({ ...info, updateAvailability: 1 })
      .mockResolvedValueOnce(info);
    const loadPlugin = async () => ({
      getAppUpdateInfo,
      openAppStore: vi.fn(),
    });

    await expect(
      checkForNativeAppUpdate({ loadPlugin, platform: "android" })
    ).resolves.toBeNull();
    await expect(
      checkForNativeAppUpdate({ loadPlugin, platform: "ios" })
    ).resolves.toBeNull();
  });

  it("opens each platform's canonical store entry", async () => {
    const openAppStore = vi.fn().mockResolvedValue(undefined);
    const loadPlugin = async () => ({
      getAppUpdateInfo: vi.fn(),
      openAppStore,
    });

    await openNativeAppStore({ loadPlugin, platform: "android" });
    await openNativeAppStore({ loadPlugin, platform: "ios" });

    expect(openAppStore).toHaveBeenNthCalledWith(1, undefined);
    expect(openAppStore).toHaveBeenNthCalledWith(2, {
      appId: "6790176506",
    });
  });

  it("reprompts only after a dismissal expires or the version changes", () => {
    const update = {
      availableVersion: "21",
      currentVersion: "20",
      platform: "android" as const,
      versionKey: "android:21",
    };
    const dismissal = { dismissedAt: 1_000, versionKey: update.versionKey };

    expect(shouldPromptForNativeAppUpdate(update, null, 1_000)).toBe(true);
    expect(shouldPromptForNativeAppUpdate(update, dismissal, 2_000)).toBe(
      false
    );
    expect(
      shouldPromptForNativeAppUpdate(
        update,
        dismissal,
        1_000 + NATIVE_APP_UPDATE_REPROMPT_MS
      )
    ).toBe(true);
    expect(
      shouldPromptForNativeAppUpdate(
        { ...update, versionKey: "android:22" },
        dismissal,
        2_000
      )
    ).toBe(true);
  });
});
