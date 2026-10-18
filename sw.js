// Offline shell. Bump VERSION whenever you change any app file so phones pick up the update.
const VERSION = 'gym-log-v2';
const SHELL = [
  './', 'index.html', 'styles.css', 'app.js', 'db.js', 'rir.js', 'charts.js', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// App files: cache first (works in a basement gym). Sheet API calls go to another origin and are never cached.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then(hit => hit || fetch(e.request))
      .catch(() => caches.match('index.html'))
  );
});
