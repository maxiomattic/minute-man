// Offline support: API GETs are network-first with cached fallback,
// so the sample ballot, steps and polling places still open in a dead zone on election day.
const SHELL = 'cvas-shell-v2';
const API = 'cvas-api-v1';
const FILES = ['/', '/index.html', '/app.js', '/core.js', '/styles.css', '/manifest.webmanifest', '/icon.svg', '/fonts/big-shoulders-display-latin-wght-normal.woff2', '/fonts/public-sans-latin-wght-normal.woff2', '/views/today.js', '/views/ballot.js', '/views/act.js', '/views/crew.js', '/views/me.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, API].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('message', (e) => {
  if (e.data === 'clear-api') caches.delete(API);
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request)
        .then((r) => {
          if (r.ok) {
            const copy = r.clone();
            caches.open(API).then((c) => c.put(e.request, copy));
          }
          return r;
        })
        .catch(async () => (await (await caches.open(API)).match(e.request)) ||
          new Response(JSON.stringify({ error: 'offline' }), { status: 503, headers: { 'content-type': 'application/json' } })),
    );
    return;
  }
  // Shell: network-first so updates land immediately; cache keeps it working offline.
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(SHELL).then((c) => c.put(e.request, copy)); }
        return r;
      })
      .catch(async () => (await caches.match(e.request)) || caches.match('/index.html')),
  );
});
