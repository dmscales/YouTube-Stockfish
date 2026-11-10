import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Uploads go to local disk in the MVP; keep the worker and data out of the bundle.
  outputFileTracingExcludes: { "*": ["data/**", "worker/**"] },
};

export default nextConfig;
