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
  const workbox = new Workbox("/service-worker.js", {
    updateViaCache: "none",
  });

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
    "serviceWorker" in navigator &&
    process.env.NODE_ENV === "production" &&
    !Capacitor.isNativePlatform();

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
    // A production PWA worker can otherwise keep serving an old bundle when a
    // mobile browser opens a development host. Remove it automatically so the
    // source-mounted Vite server always owns the next reload.
    const unregister = () => {
      navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((entry) => entry.unregister());
      });
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
