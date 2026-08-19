import "@capacitor/core";

import { useAuth0 } from "@auth0/auth0-react";
import { App as Native } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { AnimatePresence } from "framer-motion";
import React, { ReactElement, Suspense, useEffect, useRef } from "react";
import { useLocation, useNavigate, useRoutes } from "react-router-dom";

import { AppLoadingState } from "~/components/AppLoadingState";
import { AutomaticCheckinsInstallBanner } from "~/components/AutomaticCheckinsInstallBanner";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { InstallPromptToast } from "~/components/InstallPromptToast";
import { LeaderboardForegroundCheckins } from "~/components/LeaderboardForegroundCheckins";
import { NativeAppUpdatePrompt } from "~/components/NativeAppUpdatePrompt";
import { NearbyTicketNotifications } from "~/components/NearbyTicketNotifications";
import { Prompt } from "~/components/Prompt";
import { deferAnalytics, useRecordPageViews } from "~/lib/analytics";
import { useOnline, useWSF } from "~/lib/api";
import {
  getIosAuthFailurePath,
  isAuth0CallbackUrl,
  isStaleAuth0CallbackError,
} from "~/lib/auth";
import { useDevice } from "~/lib/device";
import { initializeOtaUpdater } from "~/lib/ota";
import { usePush } from "~/lib/push";
import { slugs } from "~/lib/terminals";
import { useUser } from "~/lib/user";
import { createAppRoutes } from "~/routes";
import DumpsterFireIcon from "~/static/images/icons/solid/dumpster-fire.svg";
import OfflineIcon from "~/static/images/icons/solid/signal-alt-slash.svg";

const InitialRouteReady = ({
  children,
  onReady,
}: React.PropsWithChildren<{ onReady: () => void }>): ReactElement => {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return <>{children}</>;
};

// application shell
export const App = ({
  suspendInitialRoute = false,
}: {
  suspendInitialRoute?: boolean;
}): ReactElement => {
  const initialRoutePending = useRef(suspendInitialRoute);
  useEffect(() => {
    // Acknowledge the bundle only after the app has rendered successfully.
    initializeOtaUpdater({
      environment: {
        VITE_OTA_CHANNEL: process.env.VITE_OTA_CHANNEL,
        VITE_OTA_MANIFEST_URL: process.env.VITE_OTA_MANIFEST_URL,
      },
    }).catch(() => undefined);
  }, []);
  useEffect(() => deferAnalytics(), []);
  const isOnline = useOnline();
  const isWsfOffline = useWSF()?.offline ?? false;
  const [offlineDismissed, setOfflineDismissed] = React.useState(false);
  const [wsfDismissed, setWsfDismissed] = React.useState(false);
  const device = useDevice();
  useRecordPageViews();
  const navigate = useNavigate();
  const location = useLocation();
  const { handleRedirectCallback } = useAuth0();
  const [{ alertRules }] = useUser();
  const initializePush = usePush(false);
  const routeResetKey = `${location.pathname}${location.search}`;
  const routeParts = location.pathname.split("/").filter(Boolean);
  const isScheduleRoute =
    // one-terminal route
    (routeParts.length === 1 && slugs.includes(routeParts[0])) ||
    // two-terminal route
    (routeParts.length === 2 &&
      slugs.includes(routeParts[0]) &&
      slugs.includes(routeParts[1]));
  const hasBottomBar = slugs.includes(routeParts[0] ?? "");

  // wrap route element
  const withRouteBoundary = (
    label: string,
    routeElement: ReactElement
  ): ReactElement => (
    <ErrorBoundary
      resetKey={routeResetKey}
      fallbackTitle={`${label} crashed`}
      fallbackMessage="This page hit an unexpected error. Use the menu or footer to keep navigating."
    >
      {routeElement}
    </ErrorBoundary>
  );

  useEffect(() => {
    const hasAlertRules = (alertRules?.length ?? 0) > 0;
    // alert guard
    if (hasAlertRules) {
      initializePush();
    }
  }, [alertRules]);

  // auth callback
  const handleCallback = async (url: string) => {
    let appUrl: URL;
    try {
      appUrl = new URL(url);
    } catch {
      return;
    }
    if (isAuth0CallbackUrl(url)) {
      if (
        appUrl.searchParams.has("state") &&
        (appUrl.searchParams.has("code") || appUrl.searchParams.has("error"))
      ) {
        try {
          const { appState } = await handleRedirectCallback(url);
          if (appState?.redirectPath) {
            navigate(appState.redirectPath);
            return;
          }
        } catch (error) {
          // A callback URL can be replayed by browser restoration or a second
          // native app-open event after Auth0 has already consumed its state.
          if (!isStaleAuth0CallbackError(error)) {
            const failurePath = getIosAuthFailurePath(error, device?.platform);
            // ios failure handoff
            if (failurePath) {
              navigate(failurePath);
              return;
            }
            throw error;
          }
        }
      }
      navigate("/");
      return;
    }
    navigate(`${appUrl.pathname || "/"}${appUrl.search}${appUrl.hash}`);
  };

  useEffect(() => {
    if (device?.isNativeMobile) {
      const listener = Native.addListener("appUrlOpen", async ({ url }) => {
        // Dismiss the native auth browser before processing its callback.
        try {
          await Browser.close();
        } catch (error) {
          console.error("Auth browser close failed", error);
        }
        try {
          await handleCallback(url);
        } catch (error) {
          console.error("Auth redirect callback failed", error);
        }
      });

      return () => {
        listener
          .then((handle) => handle.remove())
          .catch((error) =>
            console.error("Auth listener cleanup failed", error)
          );
      };
    }
  }, [handleRedirectCallback, device?.isNativeMobile]);

  useEffect(() => {
    const listener = Native.addListener("backButton", () => {
      navigate(-1);
    });
    return () => {
      listener.then((handle) => handle.remove()).catch(() => undefined);
    };
  }, [navigate]);

  useEffect(() => {
    handleCallback(window.location.href).catch((error) =>
      console.error("Auth redirect callback failed", error)
    );
  }, [location.pathname]);

  const element = useRoutes(createAppRoutes(withRouteBoundary));

  if (element) {
    const routeElement = initialRoutePending.current ? (
      <InitialRouteReady onReady={() => (initialRoutePending.current = false)}>
        {element}
      </InitialRouteReady>
    ) : (
      <Suspense fallback={<AppLoadingState />}>{element}</Suspense>
    );
    return (
      <>
        {routeElement}
        <AnimatePresence>
          <AutomaticCheckinsInstallBanner key="automatic-checkins-install" />
          {!isOnline && !offlineDismissed && (
            <Prompt
              key="device-offline"
              footerDocked={hasBottomBar}
              level="warning"
              onClose={() => setOfflineDismissed(true)}
              Icon={OfflineIcon}
            >
              Your device is offline! You can still view the schedule, but
              things may not be up to date.
            </Prompt>
          )}
          {isScheduleRoute && isWsfOffline && !wsfDismissed && (
            <Prompt
              key="wsf-offline"
              footerDocked={hasBottomBar}
              level="warning"
              onClose={() => setWsfDismissed(true)}
              Icon={DumpsterFireIcon}
            >
              WSF web services are offline! You can still use the app but things
              may not be up to date.
            </Prompt>
          )}
          <InstallPromptToast
            footerDocked={hasBottomBar}
            key="install-prompt"
          />
          <NativeAppUpdatePrompt
            footerDocked={hasBottomBar}
            key="native-app-update-prompt"
          />
        </AnimatePresence>
        <NearbyTicketNotifications />
        <LeaderboardForegroundCheckins />
      </>
    );
  } else {
    return <AppLoadingState />;
  }
};
