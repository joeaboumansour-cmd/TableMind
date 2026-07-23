import withPWAInit from "@ducanh2912/next-pwa";
import type { NextConfig } from "next";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  // These are handled by default, so we keep the config clean
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  // NO fallbacks.document — we NEVER want to show an offline blocking page.
  // All critical routes are precached and served by Workbox's precacheAndRoute
  // which works offline from the very first install, even on cold start.
  workboxOptions: {
    additionalManifestEntries: [
      { url: "/", revision: "tablemind-root" },
      { url: "/pos", revision: "tablemind-pos" },
      { url: "/checkout", revision: "tablemind-checkout" },
      { url: "/pos/products", revision: "tablemind-products" },
      { url: "/transactions", revision: "tablemind-transactions" },
      { url: "/login", revision: "tablemind-login" },
      { url: "/offline", revision: "tablemind-offline" },
    ],
    // No runtimeCaching needed — the additionalManifestEntries above are
    // added to precacheAndRoute, which creates handlers that serve them
    // directly from precache. These work offline on first install.
    // Non-precached routes fall through to the default NetworkFirst handler.
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