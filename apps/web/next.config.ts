import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@locket/vortex-engine",
    "@locket/ai-brain",
    "@locket/matching",
  ],
};

export default nextConfig;
