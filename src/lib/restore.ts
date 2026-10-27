import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { activeSessions, isClaudeProcess } from "./active";
import { jsonStore } from "./jsonStore";
import { findSessionFile, listSessions } from "./sessions";
import { getSettings } from "./settings";
import { openInTerminal } from "./terminal";
import type { CrashedSession } from "./types";

// When a CLI session exits normally, Claude Code deletes its
// ~/.claude/sessions/<pid>.json. After a crash or a reboot the file stays but
// the process is gone, so a leftover file means "stopped unexpectedly".
const REGISTRY = path.join(os.homedir(), ".claude", "sessions");

interface Seen {
  sessionId: string;
  cwd: string;
  stoppedAt: string; // when Lens first noticed
  handled?: "restored" | "dismissed";
}

// We copy what we find, in case the CLI cleans up leftover files later.
const store = jsonStore<Record<string, Seen>>("restore.json", () => ({}));

async function scanRegistry() {
  const files = await fs.readdir(REGISTRY).catch(() => []);
  const found: Record<string, Omit<Seen, "stoppedAt">> = {};
  await Promise.all(
    files
      .filter((f) => /^\d+\.json$/.test(f))
      .map(async (f) => {
        try {
          const d = JSON.parse(await fs.readFile(path.join(REGISTRY, f), "utf8"));
          // Desktop-app sessions are the app's to restore; one-off `-p` runs aren't worth it.
          if (d.entrypoint !== "cli" || d.kind !== "interactive") return;
          if (typeof d.sessionId !== "string" || typeof d.cwd !== "string") return;
          if (await isClaudeProcess(d.pid)) return; // still running
          found[`${d.pid}-${d.startedAt}`] = { sessionId: d.sessionId, cwd: d.cwd };
        } catch {}
      }),
  );
  return found;
}

export async function crashedSessions(): Promise<CrashedSession[]> {
  const found = await scanRegistry();
  const seen = await store.update((s) => {
    for (const [key, f] of Object.entries(found)) s[key] ??= { ...f, stoppedAt: new Date().toISOString() };
    return { ...s };
  });
  const [active, sessions] = await Promise.all([activeSessions(), listSessions()]);
  const titles = new Map(sessions.map((s) => [s.id, s.title]));

  const out: CrashedSession[] = [];
  for (const [key, s] of Object.entries(seen)) {
    // Skip ones already handled, already reopened somewhere, or whose transcript is gone.
    if (s.handled || active.has(s.sessionId) || !(await findSessionFile(s.sessionId))) continue;
    out.push({ key, sessionId: s.sessionId, cwd: s.cwd, stoppedAt: s.stoppedAt, title: titles.get(s.sessionId) ?? "Untitled session" });
  }
  return out;
}

export async function restore(key: string) {
  const s = (await store.load())[key];
  if (!s) return false;
  const { terminalApp } = await getSettings();
  await openInTerminal(s.cwd, ["claude", "--resume", s.sessionId], terminalApp);
  await store.update((all) => void (all[key] && (all[key].handled = "restored")));
  return true;
}

export async function dismiss(key: string) {
  await store.update((all) => void (all[key] && (all[key].handled = "dismissed")));
}
