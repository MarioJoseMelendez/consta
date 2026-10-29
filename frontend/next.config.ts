import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "export",
  images: {
    unoptimized: true,
  },
  transpilePackages: ["@consta/contracts"],
  trailingSlash: true,
  poweredByHeader: false,
};

export default nextConfig;
