import React, { ReactElement, useEffect, useState } from "react";

import { useLocalStorage } from "~/lib/browser";
import {
  hasInstallPrompt,
  subscribeInstallPrompt,
  triggerInstallPrompt,
} from "~/lib/installPrompt";
import DownloadIcon from "~/static/images/icons/solid/download.svg";

import { Toast } from "./Toast";

const INSTALL_PROMPT_LOAD_COUNT_KEY = "installPromptLoadCount";
const INSTALL_PROMPT_HIDE_KEY = "hideInstallPrompt";
const INSTALL_PROMPT_LOAD_THRESHOLD = 10;

// install prompt toast
export const InstallPromptToast = (): ReactElement | null => {
  const [loadCount, setLoadCount] = useLocalStorage<number>(
    INSTALL_PROMPT_LOAD_COUNT_KEY,
    0
  );
  const [hideInstallPrompt, setHideInstallPrompt] = useLocalStorage<boolean>(
    INSTALL_PROMPT_HIDE_KEY,
    false
  );
  const [promptAvailable, setPromptAvailable] = useState(hasInstallPrompt());
  const [dismissedThisSession, setDismissedThisSession] = useState(false);

  useEffect(() => {
    // count site loads
    setLoadCount(loadCount + 1);
  }, []);

  useEffect(() => {
    // sync prompt availability
    return subscribeInstallPrompt(() => setPromptAvailable(hasInstallPrompt()));
  }, []);

  // visibility guard
  if (
    hideInstallPrompt ||
    dismissedThisSession ||
    loadCount < INSTALL_PROMPT_LOAD_THRESHOLD ||
    !promptAvailable
  ) {
    return null;
  }

  return (
    <Toast info footerDocked>
      <span className="font-bold block">Install on your homescreen?</span>
      Get back to Ferry FYI easier by adding it to your homescreen
      <div className="button-group mt-5">
        <button
          className="button button-group-left alert__button-primary truncate bg-blue-dark border-transparent text-white hover:bg-blue-darkest"
          onClick={async () => {
            // trigger prompt
            await triggerInstallPrompt();
            setDismissedThisSession(true);
          }}
        >
          <DownloadIcon className="button-icon" />
          <span className="button-label">Install</span>
        </button>

        <button
          className="button button-group-right truncate"
          onClick={() => setHideInstallPrompt(true)}
        >
          No thanks
        </button>
      </div>
    </Toast>
  );
};
