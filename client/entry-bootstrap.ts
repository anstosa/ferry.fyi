import { PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE } from "shared/contracts/ssrDocument";

import {
  installArrayAtPolyfill,
  installObjectHasOwnPolyfill,
  installPreloadRecovery,
} from "./lib/runtimeRecovery";

type BrowserWindow = Window & {
  Capacitor?: { isNativePlatform?: () => boolean };
  requestIdleCallback?: (
    callback: IdleRequestCallback,
    options?: IdleRequestOptions
  ) => number;
};

type DeferredStartupOptions = {
  document?: Document;
  loadClient?: () => Promise<{ clientReady?: Promise<unknown> }>;
  loadSentry?: () => Promise<{ startSentry: () => Promise<unknown> }>;
  window?: BrowserWindow;
};

const CLIENT_STARTUP_RETRY_DELAY_MS = 5_000;
const CLIENT_STARTUP_EVENTS = [
  "focusin",
  "keydown",
  "pointerdown",
  "pointermove",
] as const;

const afterInitialPaint = (
  callback: () => void,
  window: BrowserWindow
): void => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(callback);
  });
};

const afterStartupSettles = (
  callback: () => void,
  window: BrowserWindow
): void => {
  const delay = window.Capacitor?.isNativePlatform?.() ? 0 : 10_000;
  window.setTimeout(() => {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(callback, { timeout: 3_000 });
      return;
    }
    callback();
  }, delay);
};

const hasDeferredSnapshot = (document: Document): boolean => {
  const root = document.querySelector("#root");
  return (
    root?.getAttribute(PUBLIC_SSR_DOCUMENT_MODE_ATTRIBUTE) === "snapshot" &&
    root.hasChildNodes()
  );
};

const scheduleClientStartup = (
  document: Document,
  loadClient: () => Promise<{ clientReady?: Promise<unknown> }>,
  window: BrowserWindow
): void => {
  const root = document.querySelector("#root");
  let ready = false;
  let recoveryScheduled = false;
  let startup: Promise<void> | undefined;
  const start = (): Promise<void> => {
    startup ??= loadClient()
      .then(({ clientReady }) => clientReady)
      .then(() => {
        ready = true;
        CLIENT_STARTUP_EVENTS.forEach((eventName) => {
          window.removeEventListener(eventName, startOnIntent);
        });
        window.removeEventListener("click", replayDeferredClick, true);
      })
      .catch((error: unknown) => {
        startup = undefined;
        console.error("Ferry FYI client startup failed", error);
        if (!recoveryScheduled) {
          recoveryScheduled = true;
          window.setTimeout(start, CLIENT_STARTUP_RETRY_DELAY_MS);
        }
      });
    return startup;
  };
  const startOnIntent = () => {
    start();
  };
  const replayDeferredClick = (event: MouseEvent) => {
    if (ready || !(event.target instanceof Element)) {
      return;
    }
    const target = event.target.closest<HTMLElement>("button, [role=button]");
    if (
      !target ||
      target instanceof HTMLAnchorElement ||
      !root?.contains(target)
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    start().then(() => {
      if (ready && target.isConnected) {
        target.click();
      }
    });
  };

  if (!hasDeferredSnapshot(document)) {
    start();
    return;
  }

  CLIENT_STARTUP_EVENTS.forEach((eventName) => {
    window.addEventListener(eventName, startOnIntent, { passive: true });
  });
  window.addEventListener("click", replayDeferredClick, true);
  // Begin loading immediately after the server-rendered first paint. Intent
  // listeners preserve interactions while the browser phase is still loading.
  start();
};

export const scheduleDeferredStartup = (
  options: DeferredStartupOptions = {}
): void => {
  const browserWindow = options.window ?? (globalThis.window as BrowserWindow);
  const document = options.document ?? browserWindow.document;
  const loadClient = options.loadClient ?? (() => import("./entry-client"));
  const loadSentry = options.loadSentry ?? (() => import("./lib/sentry"));
  const scheduleSentry = () => {
    afterStartupSettles(() => {
      loadSentry()
        .then(({ startSentry }) => startSentry())
        .catch(() => undefined);
    }, browserWindow);
  };

  if (!hasDeferredSnapshot(document)) {
    scheduleClientStartup(document, loadClient, browserWindow);
    afterInitialPaint(scheduleSentry, browserWindow);
    return;
  }

  afterInitialPaint(() => {
    scheduleClientStartup(document, loadClient, browserWindow);
    scheduleSentry();
  }, browserWindow);
};

if (
  typeof window !== "undefined" &&
  (window as Window & { __FERRY_FYI_BOOTSTRAP__?: boolean })
    .__FERRY_FYI_BOOTSTRAP__
) {
  installArrayAtPolyfill();
  installObjectHasOwnPolyfill();
  installPreloadRecovery();
  scheduleDeferredStartup();
}
