import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  transpilePackages: ['@launchpilot/core'],
  // sql.js resolves its WASM file relative to the package at runtime.
  serverExternalPackages: ['better-sqlite3', 'simple-git', 'sql.js'],
  turbopack: {
    root: resolve(__dirname, '../..'),
    resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
};

export default nextConfig;
