// M&M Laundry Service Worker - PWA & Offline Support
//
// Bump SW_VERSION on every deploy that changes index.html, app.js, styles.css
// or any precached asset. Old caches with the same prefix are purged on activate.
const SW_VERSION = '2.2.0';
const CACHE_PREFIX = 'mm-laundry-';
const STATIC_CACHE = `${CACHE_PREFIX}static-${SW_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${SW_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/src/assets/images/icons/logo-mark-128.png',
  '/src/assets/images/icons/mm-logo-128.jpg',
  '/src/assets/images/icons/icon-192.png',
  '/src/assets/images/laundry_hero_interior_1789125391100.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== STATIC_CACHE && key !== RUNTIME_CACHE)
        .map((key) => caches.delete(key))
    )).then(() => self.clients.claim())
  );
});

function isCacheableResponse(res) {
  return res && res.status === 200 && res.type === 'basic';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Only handle same-origin requests; let the browser deal with fonts/CDNs.
  if (url.origin !== self.location.origin) return;

  // 1. API: network only, never cache (responses contain personal data).
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => new Response(JSON.stringify({
        error: 'You appear to be offline. Please reconnect and try again.',
        offline: true
      }), { status: 503, headers: { 'Content-Type': 'application/json' } }))
    );
    return;
  }

  // 2. Page navigations: network-first so new deploys are picked up immediately,
  //    falling back to the cached app shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        if (isCacheableResponse(res)) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put('/', copy));
        }
        return res;
      }).catch(() => caches.match('/'))
    );
    return;
  }

  // 3. Images: cache-first (immutable, versioned by filename).
  if (req.destination === 'image' || /\.(jpe?g|png|webp|svg|ico)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const ct = res.headers.get('content-type') || '';
        if (isCacheableResponse(res) && !ct.includes('text/html')) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }))
    );
    return;
  }

  // 4. Scripts / styles / manifest: network-first, cache fallback (ignoring ?v= query).
  if (['script', 'style', 'manifest'].includes(req.destination) || /\.(js|css|json)$/.test(url.pathname)) {
    event.respondWith(
      fetch(req).then((res) => {
        const ct = res.headers.get('content-type') || '';
        if (isCacheableResponse(res) && !ct.includes('text/html')) {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req, { ignoreSearch: true }))
    );
  }
  // Anything else: default browser handling.
});
