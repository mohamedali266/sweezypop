/* global self, caches, fetch, URL, Response */

const CACHE_NAME = 'sweezypop-static-v6';
const CORE_ASSETS = [
  '/',
  '/pwa-icon.svg',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
  '/sweezypop-loader-v3.svg',
  '/order-received.gif',
  '/order-preparing.gif',
  '/order-ready.gif',
  '/staff-notification-v2.mp3',
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

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {}; }
  const title = data.title || 'Sweezypop';
  event.waitUntil(self.registration.showNotification(title, {
    body:data.body || '',
    icon:data.icon || '/pwa-icon-192.png',
    badge:data.badge || '/pwa-icon-192.png',
    tag:data.tag || 'sweezypop-order',
    renotify:true,
    data:{ url:data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type:'window', includeUncontrolled:true }).then(clients => {
    const existing = clients.find(client => client.url.startsWith(self.location.origin));
    if (existing) return existing.focus().then(() => existing.navigate(target));
    return self.clients.openWindow(target);
  }));
});
