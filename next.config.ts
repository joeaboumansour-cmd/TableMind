import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverMinification: true,
  },
  turbopack: {}
};

export default nextConfig;