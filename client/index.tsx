import "lib/worker";

import { Auth0Provider } from "@auth0/auth0-react";
import * as Sentry from "@sentry/react";
import React from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { BrowserRouter } from "react-router-dom";
import { isUndefined } from "shared/lib/identity";

import { ErrorBoundary } from "~/components/ErrorBoundary";
import { getConfiguredAuth0RedirectUri } from "~/lib/auth";
import { initializeTheme } from "~/lib/theme";
import { UserProvider } from "~/lib/user";

import { App } from "./App";

initializeTheme();

if (!process.env.AUTH0_DOMAIN) {
  throw Error("AUTH0_DOMAIN environment variable is not set");
}
if (!process.env.AUTH0_CLIENT_ID) {
  throw Error("AUTH0_CLIENT_ID environment variable is not set");
}
if (!process.env.AUTH0_CLIENT_AUDIENCE) {
  throw Error("AUTH0_CLIENT_AUDIENCE environment variable is not set");
}
if (!process.env.AUTH0_CLIENT_REDIRECT) {
  throw Error("AUTH0_CLIENT_REDIRECT environment variable is not set");
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    environment: process.env.NODE_ENV,
    // Will cause a deprecation warning, but the demise of `ignoreErrors` is still under discussion.
    // See: https://github.com/getsentry/raven-js/issues/73
    ignoreErrors: [
      // Random plugins/extensions
      "top.GLOBALS",
      // See: http://blog.errorception.com/2012/03/tale-of-unfindable-js-error.html
      "originalCreateNotification",
      "canvas.contentDocument",
      "MyApp_RemoveAllHighlights",
      "http://tt.epicplay.com",
      "Can't find variable: ZiteReader",
      "jigsaw is not defined",
      "ComboSearch is not defined",
      "http://loading.retry.widdit.com/",
      "atomicFindClose",
      // Facebook borked
      "fb_xd_fragment",
      // ISP "optimizing" proxy - `Cache-Control: no-transform` seems to reduce this. (thanks @acdha)
      // See http://stackoverflow.com/questions/4113268/how-to-stop-javascript-injection-from-vodafone-proxy
      "bmi_SafeAddOnload",
      "EBCallBackMessageReceived",
      // See http://toolbar.conduit.com/Developer/HtmlAndGadget/Methods/JSInjection.aspx
      "conduitPage",
      // Generic error code from errors outside the security sandbox
      // You can delete this if using raven.js > 1.0, which ignores these automatically.
      "Script error.",
      // Avast extension error
      "_avast_submit",
    ],
    denyUrls: [
      // Google Adsense
      /pagead\/js/i,
      // Facebook flakiness
      /graph\.facebook\.com/i,
      // Facebook blocked
      /connect\.facebook\.net\/en_US\/all\.js/i,
      // Woopra flakiness
      /eatdifferent\.com\.woopra-ns\.com/i,
      /static\.woopra\.com\/js\/woopra\.js/i,
      // Chrome extensions
      /extensions\//i,
      /^chrome:\/\//i,
      // Other plugins
      /127\.0\.0\.1:4001\/isrunning/i, // Cacaoweb
      /webappstoolbarba\.texthelp\.com\//i,
      /metrics\.itunes\.apple\.com\.edgesuite\.net\//i,
    ],
    dsn: process.env.SENTRY_DSN,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.25,
    release: `web@${process.env.HEROKU_RELEASE_VERSION}`,
  });
}

/**
 * @description Fires callback exactly once, after the document is loaded.
 */

const whenReady = (callback: () => void): void => {
  if (document.readyState !== "loading") {
    callback();
    return;
  }

  const handleContentLoaded = (): void => {
    callback();
    document.removeEventListener("DOMContentLoaded", handleContentLoaded);
  };

  document.addEventListener("DOMContentLoaded", handleContentLoaded);
};

whenReady(() => {
  const root = document.querySelector("#root");
  // root mount guard
  if (!root) {
    throw Error("Root element is not available");
  }
  const reactRoot = createRoot(root);

  // render app tree
  const renderAll = (): void => {
    reactRoot.render(
      <ErrorBoundary
        className="m-4"
        fallbackTitle="Ferry FYI crashed"
        fallbackMessage="The app shell hit an unexpected error. Reload the page to start fresh."
      >
        <BrowserRouter>
          <HelmetProvider>
            <Auth0Provider
              domain={process.env.AUTH0_DOMAIN as string}
              clientId={process.env.AUTH0_CLIENT_ID as string}
              authorizationParams={{
                audience: process.env.AUTH0_CLIENT_AUDIENCE as string,
                redirect_uri: getConfiguredAuth0RedirectUri(),
                scope: "openid profile email read:current_user offline_access",
              }}
              cacheLocation="localstorage"
              useRefreshTokens={true}
              useRefreshTokensFallback={true}
            >
              <UserProvider>
                <App />
              </UserProvider>
            </Auth0Provider>
          </HelmetProvider>
        </BrowserRouter>
      </ErrorBoundary>
    );
  };
  window.addEventListener("online", renderAll);
  window.addEventListener("offline", renderAll);
  renderAll();
});

// if there's a gtag, initialize it
if (!isUndefined(window.gtag)) {
  gtag("event", "conversion", {
    send_to: `${process.env.AW_TAG_ID}/78vaCLmvr4QDEJvr0tUC`,
  });
}
