import "server-only";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// Where Vlens keeps its own files (pins, settings, threads, trash…). Shared by
// the dev server and the Mac app, so both see the same state.
export const DATA_DIR = process.env.LENS_DATA_DIR || path.join(os.homedir(), "Library", "Application Support", "Vlens");

// Vlens started as Claude Lens. On the first start, copy its old folder (not
// move: Claude Lens may still be installed next to Vlens), so pins, settings,
// trash and lessons carry on. Chromium's Singleton* lock files stay behind,
// or Vlens would think Claude Lens's window owns its profile.
const OLD_DATA_DIR = path.join(os.homedir(), "Library", "Application Support", "Claude Lens");
if (!process.env.LENS_DATA_DIR && !fs.existsSync(DATA_DIR) && fs.existsSync(OLD_DATA_DIR)) {
  try {
    fs.cpSync(OLD_DATA_DIR, DATA_DIR, { recursive: true, filter: (src) => !path.basename(src).startsWith("Singleton") });
  } catch {}
}

// Vlens's built-in Claude Code plugin. The Mac app ships it next to the server.
export const PLUGIN_DIR = process.env.LENS_PLUGIN_DIR || path.join(process.cwd(), "lens-plugin");
