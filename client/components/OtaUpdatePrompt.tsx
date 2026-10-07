import React, { type ReactElement, useEffect, useState } from "react";

import {
  applyOtaUpdate,
  initializeOtaUpdater,
  type OtaUpdateState,
} from "../lib/ota";
import { Prompt } from "./Prompt";

interface Props {
  footerDocked?: boolean;
}

// show native OTA progress and explicit activation
export const OtaUpdatePrompt = ({
  footerDocked = false,
}: Props): ReactElement | null => {
  const [update, setUpdate] = useState<OtaUpdateState>({ status: "idle" });
  const [attempt, setAttempt] = useState(0);
  const [applying, setApplying] = useState(false);
  const [applyFailed, setApplyFailed] = useState(false);
  const [checking, setChecking] = useState(false);

  // acknowledge the running bundle only after the app commits
  useEffect(() => {
    let mounted = true;
    setChecking(true);
    initializeOtaUpdater({
      environment: {
        VITE_OTA_CHANNEL: process.env.VITE_OTA_CHANNEL,
        VITE_OTA_MANIFEST_URL: process.env.VITE_OTA_MANIFEST_URL,
      },
      // ignore callbacks from a retired application shell
      onStateChange: (state) => {
        // retain only live component state
        if (mounted) {
          setUpdate(state);
        }
      },
    })
      .then((result) => {
        // retain failed retries until a definitive successful check
        if (mounted) {
          setChecking(false);
          // preserve the download retry when a subsequent manifest check fails
          if (result === "failed" && attempt > 0) {
            setUpdate({ status: "failed" });
            // remove the notice only when no update is definitively available
          } else if (
            result === "up-to-date" ||
            result === "disabled" ||
            result === "native-unavailable"
          ) {
            setUpdate({ status: "idle" });
          }
        }
      })
      .catch(() => {
        // keep unexpected retry failures recoverable
        if (mounted) {
          setChecking(false);
          // avoid an initial failure notice before an update is known
          if (attempt > 0) {
            setUpdate({ status: "failed" });
          }
        }
      });
    // stop forwarding state after unmount or retry
    return () => {
      mounted = false;
    };
  }, [attempt]);

  // activate only after the user requests a reload
  const apply = async (): Promise<void> => {
    // require a fully staged bundle and avoid duplicate reloads
    if (update.status !== "ready" || applying) {
      return;
    }
    setApplying(true);
    setApplyFailed(false);
    try {
      await applyOtaUpdate();
    } catch {
      setApplying(false);
      setApplyFailed(true);
    }
  };

  // remain invisible on the web or when no update is offered
  if (update.status === "idle") {
    return null;
  }

  return (
    <Prompt footerDocked={footerDocked} persistent>
      <div aria-live="polite" role="status">
        {update.status === "downloading" &&
          "An Ferry FYI update is downloading"}
        {update.status === "ready" && "A Ferry FYI update is ready to apply."}
        {update.status === "failed" &&
          "The Ferry FYI update could not download. Please try again."}
        {applyFailed && (
          <p className="mt-2">
            The update could not be applied. Please try again.
          </p>
        )}
      </div>
      {update.status === "downloading" && (
        <div className="mt-3 flex items-center gap-3">
          <div
            aria-label="Ferry FYI update download progress"
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={update.progress}
            className="h-2 flex-1 overflow-hidden rounded-full bg-blue-dark/20 dark:bg-white/20"
            role="progressbar"
          >
            <div
              className="h-full rounded-full bg-current transition-[width]"
              style={{ width: `${update.progress}%` }}
            />
          </div>
          <span className="text-sm tabular-nums">{update.progress}%</span>
        </div>
      )}
      {update.status === "ready" && (
        <button
          className="button alert__button-primary mt-5 bg-blue-dark border-transparent text-white hover:bg-blue-darkest disabled:opacity-50"
          disabled={applying}
          onClick={apply}
          type="button"
        >
          {applying ? "Reloading…" : "Reload to apply"}
        </button>
      )}
      {update.status === "failed" && (
        <button
          className="button mt-5"
          disabled={checking}
          // restart the download check without dismissing a pending update
          onClick={() => setAttempt((current) => current + 1)}
          type="button"
        >
          {checking ? "Checking for update…" : "Retry download"}
        </button>
      )}
    </Prompt>
  );
};
