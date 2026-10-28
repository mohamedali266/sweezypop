/* global self, caches, fetch, URL, Response */

const CACHE_NAME = 'sweezypop-static-v3';
const CORE_ASSETS = [
  '/',
  '/pwa-icon.svg',
  '/sweezypop-loader-v3.svg',
  '/order-received.gif',
  '/order-preparing.gif',
  '/order-ready.gif',
  '/flags/de.svg',
  '/flags/gb.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.headers.has('authorization')) return;
  if (event.request.mode !== 'navigate' && !/^\/(assets|social-icons)\//.test(url.pathname) && !CORE_ASSETS.includes(url.pathname)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const responseClone = response.clone();
        if (response.ok) event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone)));
        return response;
      })
      .catch(() => caches.match(event.request).then(async (cached) => cached || (event.request.mode === 'navigate' ? await caches.match('/') : null) || Response.error())),
  );
});
