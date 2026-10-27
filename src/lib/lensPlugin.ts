import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR, PLUGIN_DIR } from "./paths";
import type { Settings } from "./types";

// Lens ships its own Claude Code plugin (lens-plugin/) with built-in skills.
// It's passed with --plugin-dir to the runs Lens starts, so your terminal
// `claude` never sees it. --plugin-dir loads a whole plugin, so to let each
// skill be switched off on its own, Lens assembles a small "lens" plugin with
// links to just the skills that are on.
const SKILLS: { name: string; on: (s: Settings) => boolean }[] = [
  { name: "diagrams", on: (s) => s.diagramSkill },
  { name: "whiteboard", on: (s) => s.whiteboardSkill },
];

async function assemble(names: string[]): Promise<string> {
  const id = createHash("sha1").update(names.join(",") + PLUGIN_DIR).digest("hex").slice(0, 10);
  const dir = path.join(DATA_DIR, "plugins", `lens-${id}`);
  if (await fs.stat(path.join(dir, ".claude-plugin", "plugin.json")).then(() => true, () => false)) return dir;
  const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(path.join(tmp, ".claude-plugin"), { recursive: true });
  await fs.mkdir(path.join(tmp, "skills"), { recursive: true });
  await fs.copyFile(path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), path.join(tmp, ".claude-plugin", "plugin.json"));
  for (const n of names) await fs.symlink(path.join(PLUGIN_DIR, "skills", n), path.join(tmp, "skills", n));
  // Two runs may build it at once; whoever loses keeps the winner's copy.
  await fs.rename(tmp, dir).catch(() => fs.rm(tmp, { recursive: true, force: true }));
  return dir;
}

export async function lensPluginArgs(s: Settings): Promise<string[]> {
  const names = SKILLS.filter((k) => k.on(s)).map((k) => k.name);
  return names.length ? ["--plugin-dir", await assemble(names)] : [];
}
