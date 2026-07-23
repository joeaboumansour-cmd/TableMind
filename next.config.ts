import withPWAInit from "@ducanh2912/next-pwa";
import type { NextConfig } from "next";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  // These are handled by default, so we keep the config clean
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  // Show a friendly offline page as fallback for pages not specifically precached
  fallbacks: {
    document: "/offline.html",
  },
  // Precache critical POS documents at build time so they are available
  // even on a cold offline start (no prior online visit needed)
  workboxOptions: {
    additionalManifestEntries: [
      { url: "/", revision: "tablemind-root" },
      { url: "/pos", revision: "tablemind-pos" },
      { url: "/checkout", revision: "tablemind-checkout" },
      { url: "/pos/products", revision: "tablemind-products" },
      { url: "/transactions", revision: "tablemind-transactions" },
      { url: "/offline", revision: "tablemind-offline" },
    ],
    // These routes MUST be served even when offline. The default page handler
    // uses NetworkFirst which fails when offline and falls back to offline.html.
    // By registering these with StaleWhileRevalidate BEFORE the default handler,
    // they will:
    //   1. Online: serve from network, cache the response for offline use
    //   2. Offline (visited before): serve from cached response
    //   3. Offline (cold start, never visited): fall through to NetworkFirst → offline.html
    runtimeCaching: [
      {
        // Match every critical route: /, /pos, /checkout, /pos/products, /transactions, /offline, /login
        urlPattern: /^\/(?:pos(?:\/products)?|checkout|transactions|offline|login)?$/,
        handler: "StaleWhileRevalidate",
        options: {
          cacheName: "offline-pages",
          expiration: {
            maxEntries: 64,
            maxAgeSeconds: 86400, // 24 hours
          },
        },
      },
    ],
  },
});

const nextConfig: NextConfig = {
  experimental: {
    serverMinification: true,
  },
  // Note: Turbopack is currently incompatible with many PWA plugins.
  // If you see errors during 'next dev', you may need to disable turbopack.
  // turbopack: {}, 
};

export default withPWA(nextConfig);