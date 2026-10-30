/**
 * sw.js — service worker.
 *
 * Purpose: the app keeps working in the shop when the signal drops.
 *
 * Strategy: network first, cache as the fallback. With a connection, every
 * file comes fresh from the server (and the copy in the cache is refreshed),
 * so a redeploy is picked up on the very next launch and old and new files
 * can never be mixed. If the network fails, or takes longer than a few
 * seconds (one bar of signal in a supermarket), the cached copy is served
 * instead.
 *
 * 3.0 and 4.0 used stale-while-revalidate, which served the previous launch's
 * files first. After an update that could pair a new page with old scripts
 * and leave buttons dead until the app was relaunched twice.
 *
 * The recipe importer (/api/*) is never cached — it needs the network by
 * definition, and a cached failure would be worse than none.
 *
 * When you change any file, bump the version everywhere it appears: the
 * ?v= on the <link> and <script> in index.html, the ?v= on every import
 * line in js/, the SHELL list below, and CACHE_VERSION. Versioned URLs mean
 * a phone can never run a new page against an old cached script.
 */

const CACHE_VERSION = 'meal-planner-4.1';
const NETWORK_TIMEOUT_MS = 3500;

const SHELL = [
  './',
  'index.html',
  'css/styles.css?v=4.1',
  'js/app.js?v=4.1',
  'js/store.js?v=4.1',
  'js/grocery.js?v=4.1',
  'js/data.js?v=4.1',
  'js/recipes.js?v=4.1',
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

/** fetch() that gives up after `ms`, so a weak signal falls back to the cache quickly. */
function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(request).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.includes('/.netlify/')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const fresh = await fetchWithTimeout(request, NETWORK_TIMEOUT_MS);
        if (fresh && fresh.ok && fresh.type !== 'opaque') {
          event.waitUntil(cache.put(request, fresh.clone()).catch(() => undefined));
        }
        return fresh;
      } catch (err) {
        const cached = await cache.match(request);
        if (cached) return cached;
        // Navigations: any cached copy of the page will do.
        if (request.mode === 'navigate') {
          const shell = (await cache.match('index.html')) || (await cache.match('./'));
          if (shell) return shell;
        }
        return new Response('Offline and this file is not cached yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain' },
        });
      }
    })(),
  );
});
