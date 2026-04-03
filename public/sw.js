const CACHE_NAME = 'golden-squirrel-v1';
// Only cache the bare essentials. Don't cache '/' if you're using Next.js 
// dynamic routes as it can cause hydration errors.
const urlsToCache = [
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Use addAll but catch errors so one missing icon doesn't kill the SW
      return cache.addAll(urlsToCache).catch(err => console.warn("Caching failed during install:", err));
    })
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // 1. Return cached version if it exists
      if (response) return response;

      // 2. Otherwise, try the network
      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
          // 3. Fallback: This prevents the 'NetworkError' crash
          return new Response("Offline content not available");
        });
    })
  );
});