import withPWAInit from "@ducanh2912/next-pwa";
import type { NextConfig } from "next";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  // NO fallbacks.document — we NEVER want to show an offline blocking page.
  // Pages are served via the default NetworkFirst runtime handler, which
  // always fetches fresh HTML when online and falls back to cache offline.
  // We do NOT precache HTML routes with static revisions — doing so would
  // freeze users on stale content forever (Workbox skips re-fetching when
  // the revision string hasn't changed). Static JS/CSS/font chunks are still
  // precached automatically because their filenames are content-hashed.
});

const nextConfig: NextConfig = {
  experimental: {
    serverMinification: true,
  },
  // Ensure the service worker is never cached by the browser/CDN so that
  // update checks always fetch the latest version. This is critical for
  // PWA auto-updates — without it, users may be stuck on an old SW.
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
      {
        source: "/workbox-:hash.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
  // Note: Turbopack is currently incompatible with many PWA plugins.
  // If you see errors during 'next dev', you may need to disable turbopack.
  // turbopack: {}, 
};

export default withPWA(nextConfig);