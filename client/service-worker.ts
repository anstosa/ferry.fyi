/// <reference lib="webworker" />
export default null;
declare let self: ServiceWorkerGlobalScope;

import { initializeApp } from "firebase/app";
import {
  getMessaging,
  isSupported,
  MessagePayload,
  onBackgroundMessage,
} from "firebase/messaging/sw";
import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import * as googleAnalytics from "workbox-google-analytics";
import {
  cleanupOutdatedCaches,
  matchPrecache,
  precacheAndRoute,
} from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import {
  CacheFirst,
  NetworkOnly,
  StaleWhileRevalidate,
} from "workbox-strategies";

import { getServiceWorkerApiPolicy } from "./lib/serviceWorkerApiPolicy";
import { registerNetworkOnlyNavigationRoute } from "./lib/serviceWorkerNavigation";

const app = initializeApp({
  apiKey: process.env.FIREBASE_API_KEY,
  projectId: process.env.FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.FIREBASE_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
});

interface Notification extends MessagePayload {
  data: {
    title: string;
    body: string;
    url: string;
  };
}

const isNotification = (payload: MessagePayload): payload is Notification =>
  Boolean(
    payload.data &&
    "title" in payload.data &&
    "body" in payload.data &&
    "url" in payload.data
  );

isSupported()
  .then((supported) => {
    if (!supported) {
      return;
    }
    const messaging = getMessaging(app);
    onBackgroundMessage(messaging, (payload) => {
      if (isNotification(payload)) {
        console.log("Background notification: ", payload.data);
        return self.registration.showNotification(payload.data.title, {
          body: payload.data.body,
          badge: "/static/images/notification-badge.png",
          icon: "/static/images/icon-192x192.png",
          data: {
            url: payload.data.url,
          },
        });
      }
      console.warn("Unhandled background message: ", payload);
    });
  })
  .catch((error) => {
    console.warn("Failed to initialize background messaging", error);
  });

// normalize notification target
const getNotificationUrl = (event: NotificationEvent): string => {
  const rawUrl = event.notification.data?.url;
  // missing url fallback
  if (typeof rawUrl !== "string") {
    return self.location.origin;
  }
  return new URL(rawUrl, self.location.origin).href;
};

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const url = getNotificationUrl(event);
  event.waitUntil(
    self.clients
      .matchAll({
        type: "window",
      })
      .then((clientList) => {
        // focus existing client
        for (let index = 0; index < clientList.length; index++) {
          const client = clientList[index];
          client.navigate(url);
          return client.focus();
        }
        return self.clients.openWindow(url);
      })
  );
});

self.skipWaiting();
clientsClaim();

// Always ask the server for documents so an installed PWA receives the current
// SSR response. Only a failed navigation may use the dedicated offline shell.
registerNetworkOnlyNavigationRoute({
  matchPrecache,
  NetworkOnly,
  registerRoute,
});

precacheAndRoute((self as any).__WB_MANIFEST);
cleanupOutdatedCaches();

googleAnalytics.initialize();

const CACHE_FONTS = "fonts";
const CACHE_OTHER = "other";

// cache all first-party requests

registerRoute(
  ({ request, url }) =>
    getServiceWorkerApiPolicy({ request, url }) === "network-only",
  new NetworkOnly()
);

// Aggresively cache fonts
registerRoute(
  new RegExp("https://fonts\\.(googleapis|gstatic)\\.com/.*"),
  new CacheFirst({
    cacheName: CACHE_FONTS,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
      }),
    ],
  })
);

// Aggressively cache small static resources. Do not intercept JS/CSS: hashed
// application bundles should stream directly through the browser HTTP cache so a
// service-worker cache fill cannot block first paint or update loads.
registerRoute(
  new RegExp("\\.(?:gif|ico|jpe?g|png|svg|webp|woff2?)$"),
  new StaleWhileRevalidate({
    cacheName: CACHE_OTHER,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
      }),
    ],
  })
);
