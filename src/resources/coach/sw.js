// Caches the app shell so the coach page opens with no connection (needs a secure context, e.g. localhost over USB).
const CACHE = 'packout-coach-v2';
const SHELL = ['./', 'index.html', 'app.js', 'frames.js', 'jsqr.js', 'styles.css', 'manifest.webmanifest', 'icon.png'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.endsWith('data.json')) return; // always live; the page falls back to its saved copy
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
