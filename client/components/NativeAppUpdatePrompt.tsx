import { App as NativeApp } from "@capacitor/app";
import React, { type ReactElement, useEffect, useRef, useState } from "react";

import {
  checkForNativeAppUpdate,
  type NativeAppUpdateCandidate,
  type NativeAppUpdateDismissal,
  openNativeAppStore,
  shouldPromptForNativeAppUpdate,
} from "~/lib/nativeAppUpdate";
import { useAppRenderContext } from "~/lib/renderContext";
import AppStoreIcon from "~/static/images/icons/brands/app-store-ios.svg";
import GooglePlayIcon from "~/static/images/icons/brands/google-play.svg";

import { Prompt } from "./Prompt";

const DISMISSAL_STORAGE_KEY = "nativeAppUpdateDismissal";

interface Props {
  footerDocked?: boolean;
}

const readDismissal = (): NativeAppUpdateDismissal | null => {
  try {
    const value = window.localStorage.getItem(DISMISSAL_STORAGE_KEY);
    if (!value) {
      return null;
    }
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("dismissedAt" in parsed) ||
      !("versionKey" in parsed) ||
      typeof parsed.dismissedAt !== "number" ||
      typeof parsed.versionKey !== "string"
    ) {
      return null;
    }
    return {
      dismissedAt: parsed.dismissedAt,
      versionKey: parsed.versionKey,
    };
  } catch {
    return null;
  }
};

const writeDismissal = (dismissal: NativeAppUpdateDismissal): void => {
  try {
    window.localStorage.setItem(
      DISMISSAL_STORAGE_KEY,
      JSON.stringify(dismissal)
    );
  } catch {
    // A private or full storage area must not block the store action.
  }
};

/** Prompts native users when their platform store reports a newer binary. */
export const NativeAppUpdatePrompt = ({
  footerDocked = false,
}: Props): ReactElement | null => {
  const { platform, runtime } = useAppRenderContext();
  const isNative = platform === "android" || platform === "ios";
  const [update, setUpdate] = useState<NativeAppUpdateCandidate | null>(null);
  const dismissalRef = useRef<NativeAppUpdateDismissal | null>(null);
  const checkInFlightRef = useRef(false);

  useEffect(() => {
    dismissalRef.current = readDismissal();
  }, []);

  useEffect(() => {
    if (!isNative || runtime !== "browser") {
      return;
    }

    let mounted = true;
    const check = async (): Promise<void> => {
      const now = Date.now();
      if (checkInFlightRef.current) {
        return;
      }
      checkInFlightRef.current = true;
      try {
        const candidate = await checkForNativeAppUpdate({ platform });
        if (!mounted) {
          return;
        }
        setUpdate(
          candidate &&
            shouldPromptForNativeAppUpdate(candidate, dismissalRef.current, now)
            ? candidate
            : null
        );
      } catch {
        // Store/network failures never block the application.
      } finally {
        // eslint-disable-next-line require-atomic-updates -- this effect owns the in-flight flag.
        checkInFlightRef.current = false;
      }
    };

    check().catch(() => undefined);
    const listener = NativeApp.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        check().catch(() => undefined);
      }
    });

    return () => {
      mounted = false;
      listener.then((handle) => handle.remove()).catch(() => undefined);
    };
  }, [isNative, platform, runtime]);

  if (!update) {
    return null;
  }

  const storeName = update.platform === "android" ? "Google Play" : "App Store";
  const StoreIcon =
    update.platform === "android" ? GooglePlayIcon : AppStoreIcon;
  const dismiss = (): void => {
    const dismissal = {
      dismissedAt: Date.now(),
      versionKey: update.versionKey,
    };
    dismissalRef.current = dismissal;
    writeDismissal(dismissal);
    setUpdate(null);
  };

  return (
    <Prompt
      actions={[
        {
          Icon: StoreIcon,
          label: `Open ${storeName}`,
          onClick: async () => {
            try {
              await openNativeAppStore({ platform: update.platform });
              dismiss();
            } catch {
              // Keep the prompt visible so the user can retry.
            }
          },
          primary: true,
        },
      ]}
      footerDocked={footerDocked}
      onClose={dismiss}
      title="Update Ferry FYI"
    >
      A newer version of Ferry FYI is available from {storeName}.
    </Prompt>
  );
};
