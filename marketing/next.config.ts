import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This standalone app must not inherit the operational web app's tooling.
  turbopack: { root: __dirname },
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
