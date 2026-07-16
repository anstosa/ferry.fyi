import React, { ReactElement } from "react";

import {
  APPLE_APP_STORE_URL,
  getBrowserInstallPlatform,
  GOOGLE_PLAY_URL,
} from "~/lib/appInstall";
import { isInstalledApp } from "~/lib/device";
import AppStoreIcon from "~/static/images/icons/brands/app-store-ios.svg";
import GooglePlayIcon from "~/static/images/icons/brands/google-play.svg";
import DownloadIcon from "~/static/images/icons/solid/download.svg";

// inline native-app reminder for browser-only features
export const AppTeaser = (): ReactElement | null => {
  const platform = getBrowserInstallPlatform();

  if (isInstalledApp()) {
    return null;
  }

  let Icon = DownloadIcon;
  let label = "Add Ferry FYI to your home screen for the app-like experience.";
  let url: string | undefined;
  if (platform === "android") {
    Icon = GooglePlayIcon;
    label = "Get Ferry FYI from Google Play.";
    url = GOOGLE_PLAY_URL;
  } else if (platform === "ios") {
    Icon = AppStoreIcon;
    label = "Get Ferry FYI from the App Store.";
    url = APPLE_APP_STORE_URL;
  }

  return (
    <aside className="rounded-2xl border border-blue-dark/20 bg-blue-lightest/60 p-4 text-sm text-blue-dark dark:border-[#6fb8c8]/30 dark:bg-[#6fb8c8]/10 dark:text-[#d8f4fb]">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 w-5 shrink-0" />
        <div>
          <p className="font-bold">Notifications work better in the app.</p>
          <p className="mt-1 leading-relaxed">
            {url ? (
              <a className="font-bold underline" href={url}>
                {label}
              </a>
            ) : (
              label
            )}
          </p>
        </div>
      </div>
    </aside>
  );
};
