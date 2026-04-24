const CACHE_NAME = 'booststore-v4';
const APP_ASSETS = [
  '/',
  '/social_media_marketplace.html',
  '/admin.html',
  '/styles.css',
  '/admin.css',
  '/script.js',
  '/admin.js',
  '/manifest.json',
  '/logo-32.png',
  '/logo-180.png',
  '/logo-192.png',
  '/logo-512.png',
  '/logo.jpeg'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames =>
      Promise.all(
        cacheNames
          .filter(cacheName => cacheName !== CACHE_NAME)
          .map(cacheName => caches.delete(cacheName))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;
  const isNavigationRequest = event.request.mode === 'navigate';
  const isFreshAsset =
    requestUrl.pathname.endsWith('.html') ||
    requestUrl.pathname.endsWith('.css') ||
    requestUrl.pathname.endsWith('.js') ||
    requestUrl.pathname.endsWith('.json');

  if (isSameOrigin && (isNavigationRequest || isFreshAsset)) {
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          const responseClone = networkResponse.clone();

          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });

          return networkResponse;
        })
        .catch(() =>
          caches.match(event.request).then(cachedResponse => {
            if (cachedResponse) {
              return cachedResponse;
            }

            if (isNavigationRequest) {
              return caches.match('/social_media_marketplace.html');
            }

            throw new Error('Resource unavailable');
          })
        )
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then(cachedResponse => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then(networkResponse => {
          const responseClone = networkResponse.clone();

          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseClone);
          });

          return networkResponse;
        })
        .catch(() => caches.match('/social_media_marketplace.html'));
    })
  );
});
