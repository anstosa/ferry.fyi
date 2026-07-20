import React, { ReactElement, useEffect, useState } from "react";

import {
  APPLE_APP_STORE_URL,
  getBrowserInstallPlatform,
  GOOGLE_PLAY_URL,
  subscribeInstallPromptRequests,
} from "~/lib/appInstall";
import { useLocalStorage } from "~/lib/browser";
import { isInstalledApp } from "~/lib/device";
import {
  hasInstallPrompt,
  subscribeInstallPrompt,
  triggerInstallPrompt,
} from "~/lib/installPrompt";
import AppStoreIcon from "~/static/images/icons/brands/app-store-ios.svg";
import GooglePlayIcon from "~/static/images/icons/brands/google-play.svg";
import DownloadIcon from "~/static/images/icons/solid/download.svg";

import { Prompt, type PromptAction } from "./Prompt";

const INSTALL_PROMPT_LOAD_COUNT_KEY = "installPromptLoadCount";
const INSTALL_PROMPT_HIDE_KEY = "hideInstallPrompt";
const INSTALL_PROMPT_LOAD_THRESHOLD = 2;

interface Props {
  footerDocked?: boolean;
}

// install prompt toast
export const InstallPromptToast = ({
  footerDocked = false,
}: Props): ReactElement | null => {
  const [loadCount, setLoadCount] = useLocalStorage<number>(
    INSTALL_PROMPT_LOAD_COUNT_KEY,
    0
  );
  const [hideInstallPrompt, setHideInstallPrompt] = useLocalStorage<boolean>(
    INSTALL_PROMPT_HIDE_KEY,
    false
  );
  const [promptAvailable, setPromptAvailable] = useState(hasInstallPrompt());
  const platform = getBrowserInstallPlatform();

  useEffect(() => {
    // count site loads
    setLoadCount(loadCount + 1);
  }, []);

  useEffect(() => {
    // sync prompt availability
    return subscribeInstallPrompt(() => setPromptAvailable(hasInstallPrompt()));
  }, []);

  useEffect(() => {
    return subscribeInstallPromptRequests(() => setHideInstallPrompt(false));
  }, [setHideInstallPrompt]);

  // visibility guard
  if (
    hideInstallPrompt ||
    loadCount < INSTALL_PROMPT_LOAD_THRESHOLD ||
    isInstalledApp()
  ) {
    return null;
  }

  let message =
    "Add this website to your home screen for faster access and better notifications.";
  let actions: PromptAction[] | undefined;
  if (platform === "android") {
    message =
      "Get faster access and more reliable notifications with the Android app.";
    actions = [
      {
        Icon: GooglePlayIcon,
        href: GOOGLE_PLAY_URL,
        label: "Get the app",
        primary: true,
      },
      {
        className:
          "button-stealth h-auto px-0 text-sm font-bold normal-case tracking-normal underline hover:translate-y-0",
        label: "Add homescreen shortcut",
        onClick: async () => {
          await triggerInstallPrompt();
        },
      },
    ];
  } else if (platform === "ios") {
    message =
      "Get faster access and more reliable notifications with the iPhone and iPad app.";
    actions = [
      {
        Icon: AppStoreIcon,
        href: APPLE_APP_STORE_URL,
        label: "Get the app",
        primary: true,
      },
      {
        className:
          "button-stealth h-auto px-0 text-sm font-bold normal-case tracking-normal underline hover:translate-y-0",
        label: "Add homescreen shortcut",
        onClick: async () => {
          await triggerInstallPrompt();
        },
      },
    ];
  } else if (promptAvailable) {
    actions = [
      {
        Icon: DownloadIcon,
        label: "Install website",
        onClick: async () => {
          await triggerInstallPrompt();
        },
        primary: true,
      },
    ];
  }

  return (
    <Prompt
      actions={actions}
      actionsClassName={
        platform === "android" || platform === "ios"
          ? "flex flex-col items-center gap-3"
          : undefined
      }
      footerDocked={footerDocked}
      groupActions={platform === "web"}
      onClose={() => setHideInstallPrompt(true)}
      title={
        <span className="mb-3 block text-2xl leading-tight sm:text-3xl">
          {platform === "android" || platform === "ios"
            ? "Get the Ferry FYI app"
            : "Install Ferry FYI"}
        </span>
      }
    >
      {message}
    </Prompt>
  );
};
