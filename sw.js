// Service worker: houdt de app-shell offline beschikbaar.
// Verhoog CACHE_VERSION bij elke wijziging en voeg nieuwe bestanden toe aan PRECACHE.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `kine-${CACHE_VERSION}`;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './css/tokens.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './js/app.js',
  './js/router.js',
  './js/db.js',
  './js/repo/settings.js',
  './js/ui/dom.js',
  './js/ui/dialog.js',
  './js/ui/mode.js',
  './js/views/patient-home.js',
  './js/views/patient-list.js',
  './js/views/settings.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('kine-') && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Cache-first: alles staat in de precache; wat er niet in staat, haalt het netwerk op.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(request).catch(() => {
        if (request.mode === 'navigate') return caches.match('./index.html');
        throw new Error(`Offline en niet in cache: ${request.url}`);
      });
    })
  );
});
