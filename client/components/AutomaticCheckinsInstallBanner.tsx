import React, { type ReactElement } from "react";

import { useLocalStorage } from "~/lib/browser";
import { isNativeMobileApp } from "~/lib/device";
import { useFeatureFlags } from "~/lib/featureFlags";
import MobileIcon from "~/static/images/icons/solid/mobile-alt.svg";

import { Prompt } from "./Prompt";

const DISMISSAL_KEY = "hideAutomaticCheckinsInstallBanner";

// promote native automatic check-ins on the web
export const AutomaticCheckinsInstallBanner = (): ReactElement | null => {
  const { automaticLeaderboardCheckinsEnabled } = useFeatureFlags();
  const [dismissed, setDismissed] = useLocalStorage(DISMISSAL_KEY, false);

  // visibility guard
  if (
    dismissed ||
    !automaticLeaderboardCheckinsEnabled ||
    isNativeMobileApp()
  ) {
    return null;
  }

  // persist one dismissal
  const dismiss = (): void => {
    setDismissed(true);
  };

  return (
    <Prompt
      actions={[
        {
          label: "Install the app",
          primary: true,
          to: "/install",
        },
      ]}
      groupActions={false}
      Icon={MobileIcon}
      level="info"
      onClose={dismiss}
      title="Automatic background check-ins"
      top
    >
      Automatic terminal check-ins are available in the Ferry FYI mobile app,
      even when the app is not open.
    </Prompt>
  );
};
