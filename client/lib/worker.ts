import { Capacitor } from "@capacitor/core";
import { Workbox } from "workbox-window";

let registration: ServiceWorkerRegistration | undefined;
let registrationPromise = Promise.resolve<
  ServiceWorkerRegistration | undefined
>(undefined);
let registrationPlanned = false;
let registrationStarted = false;
let resolveRegistration: (
  value: ServiceWorkerRegistration | undefined
) => void = () => undefined;

// read active registration
export const getRegistration = () =>
  registration ? Promise.resolve(registration) : registrationPromise;

const planRegistration = () => {
  if (registrationPlanned) {
    return;
  }
  registrationPlanned = true;
  registrationPromise = new Promise((resolve) => {
    resolveRegistration = resolve;
  });
};

const registerServiceWorker = async () => {
  planRegistration();
  if (registrationStarted) {
    return registrationPromise;
  }
  registrationStarted = true;
  const isProduction = process.env.NODE_ENV === "production";
  const workbox = new Workbox(
    isProduction ? "/service-worker.js" : "/dev-sw.js?dev-sw",
    {
      type: isProduction ? "classic" : "module",
      updateViaCache: "none",
    }
  );

  workbox.addEventListener("installed", (event) => {
    // reload updated app
    if (event.isUpdate) {
      window.location.reload();
    }
  });

  // registration fallback
  try {
    registration = await workbox.register();
    resolveRegistration(registration);
  } catch {
    resolveRegistration(undefined);
  }
  return registrationPromise;
};

/** Register or remove browser service workers after the React tree commits. */
export const initializeServiceWorker = (): (() => void) => {
  if (typeof navigator === "undefined" || typeof window === "undefined") {
    return () => undefined;
  }
  const canRegisterServiceWorker =
    "serviceWorker" in navigator && !Capacitor.isNativePlatform();

  if (canRegisterServiceWorker) {
    planRegistration();
    if (document.readyState === "complete") {
      registerServiceWorker().catch(() => undefined);
      return () => undefined;
    }
    const register = () => {
      registerServiceWorker().catch(() => undefined);
    };
    window.addEventListener("load", register, { once: true });
    return () => window.removeEventListener("load", register);
  } else if ("serviceWorker" in navigator) {
    // Native WebViews do not use the browser service worker. Remove any worker
    // left behind by an older build instead of waiting forever for a browser
    // registration that cannot exist in the native runtime.
    const unregister = () => {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.allSettled(registrations.map((entry) => entry.unregister()))
        )
        .catch(() => undefined);
    };
    if (document.readyState === "complete") {
      unregister();
      return () => undefined;
    }
    window.addEventListener("load", unregister, { once: true });
    return () => window.removeEventListener("load", unregister);
  }
  return () => undefined;
};
