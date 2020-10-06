/* global self */

import * as googleAnalytics from "workbox-google-analytics";
import {
  CacheFirst,
  NetworkFirst,
  StaleWhileRevalidate,
} from "workbox-strategies";
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching";
import { clientsClaim, skipWaiting } from "workbox-core";
import { ExpirationPlugin } from "workbox-expiration";
import { registerRoute } from "workbox-routing";

skipWaiting();
clientsClaim();

precacheAndRoute((self as any).__WB_MANIFEST);
cleanupOutdatedCaches();

googleAnalytics.initialize();

const CACHE_API = "api";
const CACHE_FONTS = "fonts";
const CACHE_OTHER = "other";

// cache all first-party requests

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
