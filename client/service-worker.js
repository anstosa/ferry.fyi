/* global workbox */

workbox.core.skipWaiting();
workbox.core.clientsClaim();

workbox.precaching.precacheAndRoute(self.__precacheManifest);
workbox.precaching.cleanupOutdatedCaches();

workbox.googleAnalytics.initialize();

const CACHE_API = 'api';
const CACHE_FONTS = 'fonts';
const CACHE_OTHER = 'other';

const customCaches = [CACHE_API, CACHE_FONTS, CACHE_OTHER];

// cache all first-party requests

workbox.routing.registerRoute(
    new RegExp('/api/.*'),
    new workbox.strategies.NetworkFirst({
        cacheName: CACHE_API,
        plugins: [
            new workbox.expiration.Plugin({
                maxEntries: 100,
            }),
        ],
    })
);

workbox.routing.registerRoute(
    new RegExp('https://fonts.(googleapis|gstatic).com/.*'),
    new workbox.strategies.CacheFirst({
        cacheName: CACHE_FONTS,
        plugins: [
            new workbox.expiration.Plugin({
                maxEntries: 10,
            }),
        ],
    })
);

workbox.routing.registerRoute(
    new RegExp('/.*'),
    new workbox.strategies.CacheFirst({
        cacheName: CACHE_OTHER,
        plugins: [
            new workbox.expiration.Plugin({
                maxEntries: 100,
            }),
        ],
    })
);

self.addEventListener('activate', async () => {
    const cacheNames = await caches.keys();
    let hasInitializedCaches = true;
    customCaches.forEach((cacheName) => {
        if (!cacheNames.includes(cacheName)) {
            hasInitializedCaches = false;
        }
    });
    if (!hasInitializedCaches) {
        await caches.delete(workbox.core.cacheNames.runtime);
    }
});
