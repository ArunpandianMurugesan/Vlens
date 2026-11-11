import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DATA_DIR, PLUGIN_DIR } from "./paths";
import type { Settings } from "./types";

// Vlens ships its own Claude Code plugin (lens-plugin/) with built-in skills.
// It's passed with --plugin-dir to the runs Vlens starts, so your terminal
// `claude` never sees it. --plugin-dir loads a whole plugin, so to let each
// skill be switched off on its own, Vlens assembles a small "lens" plugin with
// links to just the skills that are on.
//
// src: a skill from elsewhere on this Mac, linked in when it's there. The PR review
// skill is the dev-agent toolkit's shared one (its marketplace clone), so Vlens's
// reviews follow the same process as every Vendasta repo; it loads as lens:review.
export const TOOLKIT_REVIEW = path.join(os.homedir(), ".claude", "plugins", "marketplaces", "vendasta-dev-agent-toolkit", "skills", "review");
const SKILLS: { name: string; on: (s: Settings) => boolean; src?: string }[] = [
  { name: "diagrams", on: (s) => s.diagramSkill },
  { name: "whiteboard", on: (s) => s.whiteboardSkill },
  { name: "review", on: (s) => s.reviewSkill !== false, src: TOOLKIT_REVIEW },
];
const srcOf = (n: string) => SKILLS.find((k) => k.name === n)?.src ?? path.join(PLUGIN_DIR, "skills", n);
export const hasReviewSkill = () => fs.stat(path.join(TOOLKIT_REVIEW, "SKILL.md")).then(() => true, () => false);

async function assemble(names: string[]): Promise<string> {
  const id = createHash("sha1").update(names.map(srcOf).join(",") + PLUGIN_DIR).digest("hex").slice(0, 10);
  const dir = path.join(DATA_DIR, "plugins", `lens-${id}`);
  if (await fs.stat(path.join(dir, ".claude-plugin", "plugin.json")).then(() => true, () => false)) return dir;
  const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(path.join(tmp, ".claude-plugin"), { recursive: true });
  await fs.mkdir(path.join(tmp, "skills"), { recursive: true });
  await fs.copyFile(path.join(PLUGIN_DIR, ".claude-plugin", "plugin.json"), path.join(tmp, ".claude-plugin", "plugin.json"));
  for (const n of names) await fs.symlink(srcOf(n), path.join(tmp, "skills", n));
  // Two runs may build it at once; whoever loses keeps the winner's copy.
  await fs.rename(tmp, dir).catch(() => fs.rm(tmp, { recursive: true, force: true }));
  return dir;
}

export async function lensPluginArgs(s: Settings): Promise<string[]> {
  const there = async (k: (typeof SKILLS)[number]) => !k.src || (await fs.stat(path.join(k.src, "SKILL.md")).then(() => true, () => false));
  const names: string[] = [];
  for (const k of SKILLS) if (k.on(s) && (await there(k))) names.push(k.name);
  return names.length ? ["--plugin-dir", await assemble(names)] : [];
}
