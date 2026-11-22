'use strict';
// Service Worker: macht die App offline-fähig und installierbar.
// Updates: Bei jeder Veröffentlichung CACHE hochzählen (und APP_VERSION in app.js). Installierte Apps
// holen sich die neue Fassung automatisch – eine Neuinstallation ist nie nötig.
const CACHE = 'charakter-netz-v9';
const ASSETS = [
  './', './index.html', './app.js', './style.css', './manifest.webmanifest',
  './config.js', './vendor/supabase.js',
  './icon.svg', './icon-192.png', './icon-512.png', './apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  // cache: 'reload' umgeht den Browser-Cache, damit wirklich die neue Version gespeichert wird
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Netzwerk zuerst (damit Updates sofort ankommen), Cache als Rückfall für offline.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Immer beim Server nachfragen (ETag), damit Updates sofort ankommen und nicht 10 Minuten im Browser-Cache hängen
  const fresh = req.mode === 'navigate' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' });
  e.respondWith(
    fetch(fresh)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
