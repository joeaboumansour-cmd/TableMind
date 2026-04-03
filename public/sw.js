const CACHE_NAME = 'golden-squirrel-v1';
const urlsToCache = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// 1. Merged Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('SW: Pre-caching essentials');
      return cache.addAll(urlsToCache).catch(err => console.warn("Caching failed:", err));
    })
  );
  // Force the waiting service worker to become the active one immediately
  self.skipWaiting();
});

// 2. Activate Event
self.addEventListener('activate', (event) => {
  // Take control of all open tabs immediately
  event.waitUntil(clients.claim());
  console.log('SW: Activated and claiming clients');
});

// 3. Fetch Event
self.addEventListener('fetch', (event) => {
  console.log('SW: Fetch event triggered for:', event.request.url);
  event.respondWith(
    caches.match(event.request).then((response) => {
      if (response) {
        console.log('SW: Found response in cache for:', event.request.url);
        return response;
      }

      console.log('SW: Fetching from network for:', event.request.url);
      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            console.log('SW: Network response not cacheable for:', event.request.url);
            return networkResponse;
          }

          console.log('SW: Caching network response for:', event.request.url);
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch((error) => {
          console.error('SW: Network fetch failed for:', event.request.url, 'Error:', error);
          // Return a basic response instead of crashing
          return new Response("Offline content not available", {
            status: 503,
            statusText: 'Service Unavailable'
          });
        });
    })
  );
});
