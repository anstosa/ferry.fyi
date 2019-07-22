/* global workbox */

workbox.core.skipWaiting();
workbox.core.clientsClaim();
workbox.precaching.precacheAndRoute(self.__precacheManifest);
workbox.googleAnalytics.initialize();

// cache all first-party requests
workbox.routing.registerRoute(
    new RegExp('/.*'),
    new workbox.strategies.NetworkFirst()
);

// cache fonts
workbox.routing.registerRoute(
    new RegExp('https://fonts.googleapis.com/.*'),
    new workbox.strategies.CacheFirst()
);
