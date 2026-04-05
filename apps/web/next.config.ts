import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@locket/physics-engine", "@locket/ai-brain"],
};

export default nextConfig;
