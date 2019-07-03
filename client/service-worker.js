/* global workbox */

workbox.core.skipWaiting();
workbox.core.clientsClaim();
workbox.precaching.precacheAndRoute(self.__precacheManifest);

workbox.routing.registerRoute(/.*/, new workbox.strategies.NetworkFirst());
