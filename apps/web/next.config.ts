import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@locket/physics-engine",
    "@locket/ai-brain",
    "@locket/matching",
  ],
};

export default nextConfig;
