import withPWAInit from "@ducanh2912/next-pwa";
import type { NextConfig } from "next";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  // Do NOT force a reload when the browser fires 'online'. On flaky
  // connectivity this reloads the page mid-sale. Reconnect is already
  // handled by the connectivity heartbeat + sync engine.
  reloadOnOnline: false,
  // NO fallbacks.document — we NEVER want to show an offline blocking page.
  // Pages are served via the default NetworkFirst runtime handler, which
  // always fetches fresh HTML when online and falls back to cache offline.
  // We do NOT precache HTML routes with static revisions — doing so would
  // freeze users on stale content forever (Workbox skips re-fetching when
  // the revision string hasn't changed). Static JS/CSS/font chunks are still
  // precached automatically because their filenames are content-hashed.
  //
  // CRITICAL: Exclude /api/health from the service worker 'apis' cache.
  // The connectivity heartbeat probes this endpoint to detect real
  // internet connectivity. If the SW serves a cached 200 response, the
  // app always thinks it's online (offline banners never show, sync never
  // triggers on reconnect). Health checks MUST always hit the real network.
  //
  // CRITICAL: extendDefaultRuntimeCaching MUST stay true.
  // @ducanh2912/next-pwa REPLACES the default runtimeCaching table when a
  // custom array is supplied (resolveRuntimeCaching: `if (!extend) return
  // custom`). Without this flag, supplying the single /api/health rule below
  // silently drops all 19 defaults — including the `pages` NetworkFirst rule
  // that caches HTML navigations. Since we deliberately do not precache HTML
  // (see above), that leaves NO cached document at all and the POS cannot
  // open with no internet.
  // With extend on, custom rules are pushed FIRST and defaults are appended
  // only when their cacheName is not already taken, so the /api/health
  // NetworkOnly rule keeps priority over the default `apis` rule.
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      // CRITICAL: Exclude /api/health from the service worker 'apis' cache.
      // The connectivity heartbeat probes this endpoint to detect real
      // internet connectivity. If the SW serves a cached 200 response, the
      // app always thinks it's online (offline banners never show, sync never
      // triggers on reconnect). Health checks MUST always hit the real network.
      {
        urlPattern: ({ url }: { url: URL }) => url.pathname === "/api/health",
        handler: "NetworkOnly" as const,
        method: "GET",
      },
    ],
  },
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