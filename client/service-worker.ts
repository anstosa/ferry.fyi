/// <reference lib="webworker" />
export default null;
declare let self: ServiceWorkerGlobalScope;

import { initializeApp } from "firebase/app";
import {
  getMessaging,
  MessagePayload,
  onBackgroundMessage,
} from "firebase/messaging/sw";
import { clientsClaim } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import * as googleAnalytics from "workbox-google-analytics";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import {
  CacheFirst,
  NetworkFirst,
  NetworkOnly,
  StaleWhileRevalidate,
} from "workbox-strategies";

const app = initializeApp({
  apiKey: process.env.FIREBASE_API_KEY,
  projectId: process.env.FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.FIREBASE_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
});

const messaging = getMessaging(app); // the getMessaging return type is wrong...
// messaging.useServiceWorker(self.registration);

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
  } else {
    console.warn("Unhandled background message: ", payload);
  }
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

precacheAndRoute((self as any).__WB_MANIFEST);
cleanupOutdatedCaches();

googleAnalytics.initialize();

const CACHE_API = "api";
const CACHE_FONTS = "fonts";
const CACHE_OTHER = "other";

// cache all first-party requests

// keep camera freshness live
registerRoute(new RegExp("/api/cameras/frames.*"), new NetworkOnly());

// Prefer faster load for rarely changing data
registerRoute(
  new RegExp("/api/(vessels|terminals)/.*"),
  new StaleWhileRevalidate({
    cacheName: CACHE_API,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
      }),
    ],
  })
);

// Prefer more up to date data otherwise
registerRoute(
  new RegExp("/api/.*"),
  new NetworkFirst({
    cacheName: CACHE_API,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
      }),
    ],
  })
);

// Aggresively cache fonts
registerRoute(
  new RegExp("https://fonts.(googleapis|gstatic).com/.*"),
  new CacheFirst({
    cacheName: CACHE_FONTS,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
      }),
    ],
  })
);

// Aggresively cache other static resources
registerRoute(
  new RegExp("/.*"),
  new StaleWhileRevalidate({
    cacheName: CACHE_OTHER,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
      }),
    ],
  })
);
