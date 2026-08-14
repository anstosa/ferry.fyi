import React, {
  type ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import { getSeoMetadata } from "shared/lib/seo";

import { Page } from "~/components/Page";
import { SeoHelmet } from "~/components/SeoHelmet";
import {
  getBrowserInstallPlatform,
  getInstallStoreUrl,
  redirectToInstallStore,
} from "~/lib/appInstall";
import { isInstalledApp } from "~/lib/device";
import {
  hasInstallPrompt,
  subscribeInstallPrompt,
  triggerInstallPrompt,
} from "~/lib/installPrompt";
import AppStoreIcon from "~/static/images/icons/brands/app-store-ios.svg";
import GooglePlayIcon from "~/static/images/icons/brands/google-play.svg";
import DownloadIcon from "~/static/images/icons/solid/download.svg";

type InstallState = "checking" | "installed" | "ready" | "requested";

// platform-aware installation page
export const Install = (): ReactElement => {
  const platform = getBrowserInstallPlatform();
  const installed = isInstalledApp();
  const storeUrl = getInstallStoreUrl(platform);
  const [installState, setInstallState] = useState<InstallState>(
    installed ? "installed" : "checking"
  );

  // request the deferred browser installation prompt
  const requestDesktopInstall = useCallback(async (): Promise<void> => {
    try {
      const requested = await triggerInstallPrompt();
      setInstallState(requested ? "requested" : "ready");
    } catch {
      // browser gesture fallback
      setInstallState("ready");
    }
  }, []);

  useEffect(() => {
    // installed app guard
    if (installed) {
      setInstallState("installed");
      return;
    }
    // mobile store redirect
    if (redirectToInstallStore(platform)) {
      return;
    }

    // late PWA prompt listener
    const unsubscribe = subscribeInstallPrompt(() => {
      // available prompt guard
      if (hasInstallPrompt()) {
        requestDesktopInstall().catch(() => undefined);
      }
    });
    requestDesktopInstall().catch(() => undefined);
    return unsubscribe;
  }, [installed, platform, requestDesktopInstall]);

  let Icon = DownloadIcon;
  let title = "Install Ferry FYI";
  let message =
    "Install Ferry FYI for quick access to schedules, alerts, tickets, and trip tools.";

  // installed app copy
  if (installState === "installed") {
    title = "Ferry FYI is installed";
    message = "You can open Ferry FYI from your home screen or app launcher.";
  } else if (platform === "android") {
    // android store copy
    Icon = GooglePlayIcon;
    title = "Opening Google Play…";
    message =
      "If Google Play does not open automatically, use the button below.";
  } else if (platform === "ios") {
    // apple store copy
    Icon = AppStoreIcon;
    title = "Opening the App Store…";
    message =
      "If the App Store does not open automatically, use the button below.";
  } else if (installState === "requested") {
    // completed prompt copy
    message =
      "The installation request was opened. If you dismissed it, reload this page to try again.";
  } else if (installState === "ready") {
    // manual gesture fallback copy
    message =
      "Your browser did not open the install dialog automatically. Select Install Ferry FYI to try again.";
  }

  let action: ReactElement;
  // mobile store fallback
  if (storeUrl) {
    action = (
      <a className="button button-primary mt-6 inline-flex" href={storeUrl}>
        Open {platform === "android" ? "Google Play" : "the App Store"}
      </a>
    );
  } else if (installState === "installed") {
    // installed app action
    action = (
      <a className="button button-primary mt-6 inline-flex" href="/">
        Open Ferry FYI
      </a>
    );
  } else {
    // desktop install action
    action = (
      <button
        className="button button-primary mt-6 inline-flex"
        onClick={async () => {
          await requestDesktopInstall();
        }}
        type="button"
      >
        Install Ferry FYI
      </button>
    );
  }

  return (
    <Page title="Install">
      <SeoHelmet seo={getSeoMetadata("/install")} />
      <section className="mx-auto mt-8 max-w-xl rounded-2xl bg-white p-6 text-center shadow-sm dark:bg-blue-dark sm:p-10">
        <Icon className="mx-auto h-14 w-14 text-green dark:text-blue-light" />
        <h2 className="mt-5 text-2xl font-bold text-blue-dark dark:text-white">
          {title}
        </h2>
        <p className="mt-3 leading-relaxed">{message}</p>
        {action}
      </section>
    </Page>
  );
};
