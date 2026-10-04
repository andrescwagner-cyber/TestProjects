/**
 * sw.js — service worker.
 *
 * Purpose: the app keeps working in the shop when the signal drops. The app
 * shell is cached on install; afterwards every file is served from cache
 * immediately and refreshed in the background (stale-while-revalidate), so
 * opening the app is instant and a redeploy is picked up on the next launch.
 *
 * The recipe importer (/api/*) is never cached — it needs the network by
 * definition, and a cached failure would be worse than none.
 *
 * Bump CACHE_VERSION when you change any shell file.
 */

const CACHE_VERSION = 'meal-planner-3.0';

const SHELL = [
  '.',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/store.js',
  'js/grocery.js',
  'js/data.js',
  'js/recipes.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // addAll() rejects the whole install if any single file 404s, so add
      // them one at a time and tolerate individual misses.
      await Promise.all(
        SHELL.map((path) =>
          cache.add(new Request(path, { cache: 'reload' })).catch(() => undefined),
        ),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name !== CACHE_VERSION).map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/.netlify/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(request, { ignoreSearch: true });

      const network = fetch(request)
        .then((response) => {
          if (response && response.ok && response.type !== 'opaque') {
            cache.put(request, response.clone()).catch(() => undefined);
          }
          return response;
        })
        .catch(() => undefined);

      if (cached) {
        // Serve instantly, refresh in the background.
        event.waitUntil(network);
        return cached;
      }

      const fresh = await network;
      if (fresh) return fresh;

      // Offline and never cached: fall back to the app shell for navigations.
      if (request.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      return new Response('Offline and this file is not cached yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain' },
      });
    })(),
  );
});
