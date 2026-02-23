import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ['@launchpilot/core'],
  serverExternalPackages: ['better-sqlite3', 'simple-git'],
  turbopack: {
    root: resolve(__dirname, '../..'),
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
};

export default nextConfig;
