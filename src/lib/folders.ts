import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Turns "~/x" or "/x" into an absolute folder path, or null if it isn't an existing folder.
export async function resolveDir(input: string): Promise<string | null> {
  const raw = input.trim();
  if (!raw) return null;
  const expanded = raw === "~" || raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(1)) : raw;
  if (!path.isAbsolute(expanded)) return null;
  const abs = path.resolve(expanded);
  try {
    return (await fs.stat(abs)).isDirectory() ? abs : null;
  } catch {
    return null;
  }
}

export async function listDirs(dir: string) {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}
