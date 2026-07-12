import withPWAInit from "@ducanh2912/next-pwa";
import type { NextConfig } from "next";

const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  // These are handled by default, so we keep the config clean
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  // Show a friendly offline page instead of a browser error when a
  // route is not cached and the device is offline
  fallbacks: {
    document: "/offline.html",
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