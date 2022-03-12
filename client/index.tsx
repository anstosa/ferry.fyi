import * as Sentry from "@sentry/react";
import { App } from "./App";
import { Auth0Provider } from "@auth0/auth0-react";
import { BrowserRouter } from "react-router-dom";
import { BrowserTracing } from "@sentry/tracing";
import { isUndefined } from "shared/lib/identity";
import { Workbox } from "workbox-window";
import React from "react";
import ReactDOM from "react-dom";

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
  throw Error("AUTH0_CLIENT_AUDIENCE environment variable is not set");
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    environment: process.env.NODE_ENV,
    dsn: process.env.SENTRY_DSN,
    integrations: [new BrowserTracing()],
    tracesSampleRate: 1.0,
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
  const renderAll = (): void => {
    ReactDOM.render(
      <BrowserRouter>
        <Auth0Provider
          domain={process.env.AUTH0_DOMAIN as string}
          clientId={process.env.AUTH0_CLIENT_ID as string}
          redirectUri={process.env.AUTH0_CLIENT_REDIRECT as string}
          audience={process.env.AUTH0_CLIENT_AUDIENCE as string}
          scope="read:current_user"
          cacheLocation="localstorage"
        >
          <App />
        </Auth0Provider>
      </BrowserRouter>,
      root
    );
  };
  window.addEventListener("online", renderAll);
  window.addEventListener("offline", renderAll);
  renderAll();
});

if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", () => {
    const workbox = new Workbox("/service-worker.js");

    workbox.addEventListener("installed", (event) => {
      if (event.isUpdate) {
        window.location.reload();
      }
    });

    workbox.register();
  });
}

// trigger install prompt on first click
let defferedPrompt: () => void;
let hasTriggeredPrompt = false;
const prompt = () => {
  if (!hasTriggeredPrompt) {
    defferedPrompt();
    hasTriggeredPrompt = true;
  }
  window.removeEventListener("click", prompt);
};
window.addEventListener("beforeinstallprompt", (event: any) => {
  defferedPrompt = event.prompt.bind(event);
  window.addEventListener("click", prompt);
});

// if there's a gtag, initialize it
if (!isUndefined(window.gtag)) {
  gtag("event", "conversion", {
    send_to: `${process.env.AW_TAG_ID}/78vaCLmvr4QDEJvr0tUC`,
  });
}
