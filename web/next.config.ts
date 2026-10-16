import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev-mode "N" badge sits over the history sidebar; the app has its own
  // status in the header, and screenshots shouldn't carry it.
  devIndicators: false,
};

export default nextConfig;
