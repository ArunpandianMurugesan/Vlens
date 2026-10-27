import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Mac app builds into its own folder (see desktop/), so building it never
  // touches the .next folder a running dev server uses.
  distDir: process.env.LENS_DIST_DIR || ".next",
  // A self-contained server (server.js + only the modules it needs) that the
  // Mac app runs with Electron's built-in Node.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
