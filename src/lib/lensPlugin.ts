import "server-only";
import path from "node:path";
import type { Settings } from "./types";

// Lens ships its own Claude Code plugin (lens-plugin/) with built-in skills.
// It's passed with --plugin-dir to the runs Lens starts, so your terminal
// `claude` never sees it, and each skill can be switched off in Settings.
const PLUGIN_DIR = path.join(process.cwd(), "lens-plugin");

export function lensPluginArgs(s: Settings): string[] {
  return s.diagramSkill ? ["--plugin-dir", PLUGIN_DIR] : [];
}
