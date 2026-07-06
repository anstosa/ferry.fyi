import { Capacitor } from "@capacitor/core";
import { Workbox } from "workbox-window";

let registration: ServiceWorkerRegistration | undefined;
let registrationPromise = Promise.resolve<
  ServiceWorkerRegistration | undefined
>(undefined);

// read active registration
export const getRegistration = () =>
  registration ? Promise.resolve(registration) : registrationPromise;

// service worker support guard
const canRegisterServiceWorker =
  "serviceWorker" in navigator &&
  process.env.NODE_ENV === "production" &&
  !Capacitor.isNativePlatform();

// production worker guard
if (canRegisterServiceWorker) {
  registrationPromise = new Promise((resolve) => {
    window.addEventListener("load", async () => {
      const workbox = new Workbox("/service-worker.js");

      workbox.addEventListener("installed", (event) => {
        // reload updated app
        if (event.isUpdate) {
          window.location.reload();
        }
      });

      // registration fallback
      try {
        registration = await workbox.register();
        resolve(registration);
      } catch {
        resolve(undefined);
      }
    });
  });
}
