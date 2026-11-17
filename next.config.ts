import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Voice recordings are uploaded through a server action (max 20 MB per file + multipart overhead).
    serverActions: { bodySizeLimit: "21mb" },
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
