import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable x-powered-by header for security
  poweredByHeader: false,
  // Local-only app — no need for image domains
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
