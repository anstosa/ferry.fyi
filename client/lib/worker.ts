import { Workbox } from "workbox-window";

let registration: ServiceWorkerRegistration | undefined;

export const getRegistration = () => registration;

// production worker guard
if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
  window.addEventListener("load", async () => {
    const workbox = new Workbox("/service-worker.js");

    workbox.addEventListener("installed", (event) => {
      if (event.isUpdate) {
        window.location.reload();
      }
    });

    registration = await workbox.register();
  });
}
