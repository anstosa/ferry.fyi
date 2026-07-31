import { Auth0Provider } from "@auth0/auth0-react";
import { Capacitor } from "@capacitor/core";
import { Settings } from "luxon";
import React, { useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { PublicSsrHostProfile } from "shared/lib/ssrRouteMatch";

import { App } from "~/App";
import { ErrorBoundary } from "~/components/ErrorBoundary";
import { getConfiguredAuth0RedirectUri } from "~/lib/auth";
import { FeatureFlagProvider } from "~/lib/featureFlags";
import { AppRenderProvider } from "~/lib/renderContext";
import { initializeTheme } from "~/lib/theme";
import { UserProvider } from "~/lib/user";
import { initializeServiceWorker } from "~/lib/worker";

export { preloadBrowserRoute } from "~/routes";

const BrowserRuntimeEffects = (): null => {
  useEffect(() => {
    Settings.defaultZone = "America/Los_Angeles";
    const cleanupTheme = initializeTheme();
    const cleanupWorker = initializeServiceWorker();
    return () => {
      cleanupWorker();
      cleanupTheme();
    };
  }, []);
  return null;
};

const BrowserRenderContext = ({
  children,
  hostProfile,
}: React.PropsWithChildren<{ hostProfile: PublicSsrHostProfile }>) => {
  const location = useLocation();
  return (
    <AppRenderProvider
      value={{
        clock: () => Date.now(),
        hasInjectedRequest: true,
        platform: Capacitor.getPlatform() as "android" | "ios" | "web",
        requestUrl: window.location.href,
        runtime: "browser",
        seoBaseUrl: window.location.origin,
        seoHost: hostProfile,
        seoPathname: location.pathname,
      }}
    >
      {children}
    </AppRenderProvider>
  );
};

export const BrowserPhase = ({
  hostProfile,
  suspendInitialRoute,
}: {
  hostProfile: PublicSsrHostProfile;
  suspendInitialRoute: boolean;
}): React.ReactElement => {
  if (
    !process.env.AUTH0_DOMAIN ||
    !process.env.AUTH0_CLIENT_ID ||
    !process.env.AUTH0_CLIENT_AUDIENCE ||
    !process.env.AUTH0_CLIENT_REDIRECT
  ) {
    throw Error("Auth0 environment variables are not set");
  }
  return (
    <>
      <BrowserRuntimeEffects />
      <ErrorBoundary
        className="m-4"
        fallbackTitle="Ferry FYI crashed"
        fallbackMessage="The app shell hit an unexpected error. Reload the page to start fresh."
      >
        <BrowserRenderContext hostProfile={hostProfile}>
          <Auth0Provider
            domain={process.env.AUTH0_DOMAIN}
            clientId={process.env.AUTH0_CLIENT_ID}
            authorizationParams={{
              audience: process.env.AUTH0_CLIENT_AUDIENCE,
              redirect_uri: getConfiguredAuth0RedirectUri(
                Capacitor.getPlatform()
              ),
              scope: "openid profile email read:current_user offline_access",
            }}
            cacheLocation="localstorage"
            useRefreshTokens
            useRefreshTokensFallback
          >
            <FeatureFlagProvider>
              <UserProvider>
                <App suspendInitialRoute={suspendInitialRoute} />
              </UserProvider>
            </FeatureFlagProvider>
          </Auth0Provider>
        </BrowserRenderContext>
      </ErrorBoundary>
    </>
  );
};
