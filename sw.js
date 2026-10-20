// M&M Laundry service worker: offline shell and static asset caching.
// Never caches personal data: Supabase, Firebase and edge-function calls go to other origins
// and are not intercepted. Bump SW_VERSION whenever a precached file changes.
const SW_VERSION = '3.1.0';
const CACHE_PREFIX = 'mm-laundry-';
const STATIC_CACHE = `${CACHE_PREFIX}static-${SW_VERSION}`;
const RUNTIME_CACHE = `${CACHE_PREFIX}runtime-${SW_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/styles.css?v=3.1.0',
  '/js/main.js?v=3.1.0',
  '/js/ui.js',
  '/js/nav.js',
  '/manifest.json',
  '/src/assets/images/icons/logo-mark-128.png',
  '/src/assets/images/icons/icon-192.png',
  '/src/assets/fonts/inter-latin-400-normal.woff2',
  '/src/assets/fonts/inter-latin-500-normal.woff2',
  '/src/assets/fonts/inter-latin-600-normal.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== STATIC_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k)),
    )).then(() => self.clients.claim()),
  );
});

const ok = (res) => res && res.status === 200 && res.type === 'basic';

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Runtime config must always be fresh.
  if (url.pathname === '/config.js') return;

  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then((res) => {
      if (ok(res)) { const copy = res.clone(); caches.open(RUNTIME_CACHE).then((c) => c.put('/', copy)); }
      return res;
    }).catch(() => caches.match('/')));
    return;
  }

  if (req.destination === 'image' || req.destination === 'font' || url.pathname.startsWith('/vendor/')) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (ok(res)) { const copy = res.clone(); caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }

  if (['script', 'style', 'manifest'].includes(req.destination)) {
    event.respondWith(fetch(req).then((res) => {
      if (ok(res)) { const copy = res.clone(); caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true })));
  }
});
