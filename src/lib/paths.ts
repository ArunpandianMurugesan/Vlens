import "server-only";
import os from "node:os";
import path from "node:path";

// Where Lens keeps its own files (pins, settings, threads, trash…). Shared by
// the dev server and the Mac app, so both see the same state.
export const DATA_DIR = process.env.LENS_DATA_DIR || path.join(os.homedir(), "Library", "Application Support", "Claude Lens");

// Lens's built-in Claude Code plugin. The Mac app ships it next to the server.
export const PLUGIN_DIR = process.env.LENS_PLUGIN_DIR || path.join(process.cwd(), "lens-plugin");
