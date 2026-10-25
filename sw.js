// Service worker: houdt de app-shell offline beschikbaar.
// Verhoog CACHE_VERSION bij elke wijziging en voeg nieuwe bestanden toe aan PRECACHE.

const CACHE_VERSION = 'v16';
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
  './vendor/chart.umd.js',
  './data/protocol-vkb.json',
  './data/protocol-enkel.json',
  './js/domain/backup.js',
  './js/domain/criteria.js',
  './js/domain/csv.js',
  './js/domain/dates.js',
  './js/domain/feedback.js',
  './js/domain/home-log.js',
  './js/domain/lsi.js',
  './js/domain/milestones.js',
  './js/domain/overview.js',
  './js/domain/patient.js',
  './js/domain/pdf.js',
  './js/domain/progression.js',
  './js/domain/protocol.js',
  './js/domain/references.js',
  './js/domain/schedule.js',
  './js/domain/test-session.js',
  './js/domain/text.js',
  './js/domain/vald.js',
  './js/repo/backup.js',
  './js/repo/criteria-status.js',
  './js/repo/level-history.js',
  './js/repo/home-log.js',
  './js/repo/milestones.js',
  './js/repo/patients.js',
  './js/repo/settings.js',
  './js/repo/test-sessions.js',
  './js/repo/vald-mappings.js',
  './js/io/backup.js',
  './js/ui/dom.js',
  './js/ui/format.js',
  './js/ui/home-log.js',
  './js/ui/lsi-chart.js',
  './js/ui/dialog.js',
  './js/ui/mode.js',
  './js/ui/not-found.js',
  './js/ui/share-overview.js',
  './js/views/criteria-checklist.js',
  './js/views/patient-detail.js',
  './js/views/patient-form.js',
  './js/views/patient-home.js',
  './js/views/patient-list.js',
  './js/views/patient-view.js',
  './js/views/settings.js',
  './js/views/test-entry.js',
  './js/views/vald-import.js',
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
