import type {
  AppUpdateInfo,
  AppUpdatePlugin,
} from "@capawesome/capacitor-app-update";

import { APPLE_APP_STORE_ID } from "./appInstall";

export type NativeAppUpdatePlatform = "android" | "ios";

export interface NativeAppUpdateCandidate {
  availableVersion: string;
  currentVersion: string;
  platform: NativeAppUpdatePlatform;
  versionKey: string;
}

export interface NativeAppUpdateDismissal {
  dismissedAt: number;
  versionKey: string;
}

type NativeAppUpdatePlugin = Pick<
  AppUpdatePlugin,
  "getAppUpdateInfo" | "openAppStore"
>;

type LoadNativeAppUpdatePlugin = () => Promise<NativeAppUpdatePlugin>;

// Mirror the plugin enum without eagerly importing its native runtime on the web.
const UPDATE_AVAILABLE = 2;
const UPDATE_IN_PROGRESS = 3;
const IOS_STORE_COUNTRY = "US";

export const NATIVE_APP_UPDATE_REPROMPT_MS = 24 * 60 * 60 * 1000;

const loadNativeAppUpdatePlugin: LoadNativeAppUpdatePlugin = async () =>
  (await import("@capawesome/capacitor-app-update")).AppUpdate;

const parseAndroidVersionCode = (value: string): number | undefined => {
  if (!/^\d+$/u.test(value)) {
    return;
  }
  const versionCode = Number(value);
  return Number.isSafeInteger(versionCode) ? versionCode : undefined;
};

const getCandidate = (
  platform: NativeAppUpdatePlatform,
  info: AppUpdateInfo
): NativeAppUpdateCandidate | null => {
  const updateIsActionable =
    info.updateAvailability === UPDATE_AVAILABLE ||
    (platform === "android" && info.updateAvailability === UPDATE_IN_PROGRESS);
  if (!updateIsActionable) {
    return null;
  }

  const availableVersion =
    platform === "android"
      ? info.availableVersionCode
      : info.availableVersionName;
  const currentVersion =
    platform === "android" ? info.currentVersionCode : info.currentVersionName;
  if (!availableVersion) {
    return null;
  }

  if (platform === "android") {
    const availableVersionCode = parseAndroidVersionCode(availableVersion);
    const currentVersionCode = parseAndroidVersionCode(currentVersion);
    if (
      availableVersionCode === undefined ||
      currentVersionCode === undefined ||
      availableVersionCode <= currentVersionCode
    ) {
      return null;
    }
  }

  return {
    availableVersion,
    currentVersion,
    platform,
    versionKey: `${platform}:${availableVersion}`,
  };
};

/** Checks the platform store without loading a native plugin in web builds. */
export const checkForNativeAppUpdate = async ({
  loadPlugin = loadNativeAppUpdatePlugin,
  platform,
}: {
  loadPlugin?: LoadNativeAppUpdatePlugin;
  platform: NativeAppUpdatePlatform;
}): Promise<NativeAppUpdateCandidate | null> => {
  const plugin = await loadPlugin();
  const info = await plugin.getAppUpdateInfo(
    platform === "ios" ? { country: IOS_STORE_COUNTRY } : undefined
  );
  return getCandidate(platform, info);
};

/** Opens the correct store listing after an explicit user action. */
export const openNativeAppStore = async ({
  loadPlugin = loadNativeAppUpdatePlugin,
  platform,
}: {
  loadPlugin?: LoadNativeAppUpdatePlugin;
  platform: NativeAppUpdatePlatform;
}): Promise<void> => {
  const plugin = await loadPlugin();
  await plugin.openAppStore(
    platform === "ios" ? { appId: APPLE_APP_STORE_ID } : undefined
  );
};

/** Keeps a dismissed store version quiet for one day without hiding later versions. */
export const shouldPromptForNativeAppUpdate = (
  update: NativeAppUpdateCandidate,
  dismissal: NativeAppUpdateDismissal | null,
  now: number
): boolean =>
  !dismissal ||
  dismissal.versionKey !== update.versionKey ||
  now - dismissal.dismissedAt >= NATIVE_APP_UPDATE_REPROMPT_MS;
