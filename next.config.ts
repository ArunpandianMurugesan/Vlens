import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// The app's version, baked in at build time for the update check. VLENS_VERSION
// overrides it, e.g. to try the "new version" banner in dev.
const version = process.env.VLENS_VERSION || JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version;

const nextConfig: NextConfig = {
  // The Mac app builds into its own folder (see desktop/), so building it never
  // touches the .next folder a running dev server uses.
  distDir: process.env.LENS_DIST_DIR || ".next",
  // A self-contained server (server.js + only the modules it needs) that the
  // Mac app runs with Electron's built-in Node.
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  // node-pty loads a native binary at runtime, and ws has optional native
  // add-ons: keep both out of the bundle, and ship node-pty's prebuilt files
  // (pty.node, spawn-helper) with the server.
  serverExternalPackages: ["node-pty", "ws"],
  outputFileTracingIncludes: { "/api/terminal/**": ["./node_modules/node-pty/prebuilds/darwin-*/**"] },
  // Hide the Next.js dev badge (the "N" circle) in the corner; it only shows in dev anyway.
  devIndicators: false,
  env: { VLENS_VERSION: version },
};

export default nextConfig;
