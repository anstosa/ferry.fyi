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
const IOS_STORE_COUNTRY = "US";

export const NATIVE_APP_UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const NATIVE_APP_UPDATE_REPROMPT_MS = 24 * 60 * 60 * 1000;

const loadNativeAppUpdatePlugin: LoadNativeAppUpdatePlugin = async () =>
  (await import("@capawesome/capacitor-app-update")).AppUpdate;

const getCandidate = (
  platform: NativeAppUpdatePlatform,
  info: AppUpdateInfo
): NativeAppUpdateCandidate | null => {
  if (info.updateAvailability !== UPDATE_AVAILABLE) {
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
