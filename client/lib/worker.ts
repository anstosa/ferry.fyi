import { Workbox } from "workbox-window";

let registration: ServiceWorkerRegistration | undefined;

export const getRegistration = () => registration;

if ("serviceWorker" in navigator) {
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
