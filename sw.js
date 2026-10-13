// M&M Laundry Service Worker - PWA & Offline Support
const CACHE_NAME = 'mm-laundry-v9-clean';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/app.js',
  '/manifest.json',
  '/src/assets/images/regenerated_image_1790132247415.png',
  '/src/assets/images/regenerated_image_1790132145150.png',
  '/src/assets/images/regenerated_image_1790132142954.png',
  '/src/assets/images/mm_laundry_logo_1789143471006.jpg',
  '/src/assets/images/laundry_hero_interior_1789125391100.jpg',
  '/src/assets/images/wash_fold_clothes_1789125402839.jpg',
  '/src/assets/images/dry_clean_garments_1789125413572.jpg',
  '/src/assets/images/laundry_doorstep_delivery_1789125425504.jpg',
  '/src/assets/images/commercial_laundry_business_1789125441255.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // 1. Bypass AI Studio internal scripts, control plane, and non-GET requests
  if (
    url.pathname.includes('_aistudio') ||
    url.pathname.startsWith('/__aistudio') ||
    event.request.method !== 'GET'
  ) {
    return;
  }

  // 2. Network-First for API requests (never cache user secrets/credentials)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(JSON.stringify({
          error: 'Offline mode active. Your connection was temporarily interrupted. Live request could not reach dispatch server.',
          offline: true
        }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // 3. Cache-First for static assets (images, logos, fonts, css)
  if (event.request.destination === 'image' || url.pathname.match(/\.(jpg|jpeg|png|webp|svg|ico)$/)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((networkRes) => {
          if (networkRes && networkRes.status === 200) {
            const ct = networkRes.headers.get('content-type') || '';
            // Only cache if it is an actual image or binary, never HTML error pages
            if (!ct.includes('text/html')) {
              const clone = networkRes.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
            }
          }
          return networkRes;
        });
      })
    );
    return;
  }

  // 4. Scripts (.js) must NEVER cache HTML error responses or return HTML fallback
  if (event.request.destination === 'script' || url.pathname.endsWith('.js')) {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const ct = networkResponse.headers.get('content-type') || '';
          if (ct.includes('javascript')) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
        }
        return networkResponse;
      }).catch(() => {
        return caches.match(event.request);
      })
    );
    return;
  }

  // 5. HTML Navigations (Stale-While-Revalidate with /index.html fallback strictly for navigations)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => {
        // Only return /index.html if this is an explicit page navigation
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });

      return cachedResponse || fetchPromise;
    })
  );
});
