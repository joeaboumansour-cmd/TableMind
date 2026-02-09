// =============================================
// TableMind Service Worker
// Caches assets for offline access
// =============================================

const CACHE_NAME = "tablemind-v1";
const STATIC_CACHE = "tablemind-static-v1";
const DATA_CACHE = "tablemind-data-v1";

// Assets to cache immediately on install
const STATIC_ASSETS = [
  "/",
  "/dashboard",
  "/reservations",
  "/customers",
  "/waitlist",
  "/analytics",
  "/settings",
  "/manifest.json",
];

// API routes to cache with network-first strategy
const API_ROUTES = [
  "/api/waitlist",
  "/api/reservations",
  "/api/customers",
];

// Install event - cache static assets
self.addEventListener("install", (event) => {
  console.log("[ServiceWorker] Installing...");
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => {
        console.log("[ServiceWorker] Caching static assets");
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  console.log("[ServiceWorker] Activating...");
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => {
              return (
                name !== STATIC_CACHE &&
                name !== DATA_CACHE &&
                name.startsWith("tablemind-")
              );
            })
            .map((name) => {
              console.log("[ServiceWorker] Deleting old cache:", name);
              return caches.delete(name);
            })
        );
      })
      .then(() => self.clients.claim())
  );
});

// Fetch event - serve from cache or network
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== "GET") {
    return;
  }

  // Skip chrome-extension and other non-http requests
  if (!url.protocol.startsWith("http")) {
    return;
  }

  // Skip analytics API to avoid auth issues
  if (url.pathname.startsWith("/api/analytics")) {
    return;
  }

  // API requests - Network first, fall back to cache
  if (API_ROUTES.some((route) => url.pathname.startsWith(route))) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Clone the response for caching
          const responseClone = response.clone();
          caches.open(DATA_CACHE).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Network failed, try cache
          return caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Return offline response for API calls
            return new Response(
              JSON.stringify({
                offline: true,
                message: "You are offline. Changes will sync when online.",
              }),
              {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }
            );
          });
        })
    );
    return;
  }

  // Static assets - Cache first, fall back to network
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        // Return cached version and update in background
        fetch(request)
          .then((response) => {
            caches.open(STATIC_CACHE).then((cache) => {
              cache.put(request, response);
            });
          })
          .catch(() => {});
        return cachedResponse;
      }

      // Not in cache, fetch from network
      return fetch(request)
        .then((response) => {
          // Cache the new resource
          const responseClone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => {
            cache.put(request, responseClone);
          });
          return response;
        })
        .catch(() => {
          // Return offline page for navigation requests
          if (request.mode === "navigate") {
            return caches.match("/");
          }
          return new Response("Offline", { status: 503 });
        });
    })
  );
});

// Background sync for offline actions
self.addEventListener("sync", (event) => {
  console.log("[ServiceWorker] Sync event:", event.tag);

  if (event.tag === "sync-waitlist") {
    event.waitUntil(syncWaitlist());
  }

  if (event.tag === "sync-all") {
    event.waitUntil(syncAllPendingActions());
  }
});

async function syncWaitlist() {
  // This will be called when back online
  console.log("[ServiceWorker] Syncing waitlist...");

  try {
    // Send message to client to trigger sync
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({
        type: "SYNC_WAITLIST",
        timestamp: Date.now(),
      });
    });
  } catch (error) {
    console.error("[ServiceWorker] Sync failed:", error);
  }
}

async function syncAllPendingActions() {
  console.log("[ServiceWorker] Syncing all pending actions...");

  try {
    const clients = await self.clients.matchAll();
    clients.forEach((client) => {
      client.postMessage({
        type: "SYNC_ALL",
        timestamp: Date.now(),
      });
    });
  } catch (error) {
    console.error("[ServiceWorker] Full sync failed:", error);
  }
}

// Push notifications support
self.addEventListener("push", (event) => {
  console.log("[ServiceWorker] Push received:", event);

  let data = {
    title: "TableMind",
    body: "New notification",
    icon: "/icon-192.png",
    badge: "/badge-72.png",
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch (e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1,
    },
    actions: [
      { action: "view", title: "View" },
      { action: "close", title: "Close" },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click handler
self.addEventListener("notificationclick", (event) => {
  console.log("[ServiceWorker] Notification click:", event.action);

  event.notification.close();

  if (event.action === "view") {
    event.waitUntil(
      self.clients.matchAll({ type: "window" }).then((clientList) => {
        // Focus existing window or open new one
        for (const client of clientList) {
          if (client.url.includes("/waitlist") && "focus" in client) {
            return client.focus();
          }
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow("/waitlist");
        }
      })
    );
  }
});

// Message handler for communication with main app
self.addEventListener("message", (event) => {
  console.log("[ServiceWorker] Message received:", event.data);

  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }

  if (event.data && event.data.type === "CACHE_URLS") {
    event.waitUntil(
      caches.open(STATIC_CACHE).then((cache) => {
        return cache.addAll(event.data.urls);
      })
    );
  }
});
