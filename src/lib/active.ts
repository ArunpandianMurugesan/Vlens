import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { isLensRun } from "./lensRuns";
import type { ActiveInfo } from "./types";

// Each running Claude Code process writes ~/.claude/sessions/<pid>.json with its
// session id and status. A file can outlive a crashed process, so check the pid too.
const REGISTRY = path.join(os.homedir(), ".claude", "sessions");

export function isAlive(pid: number) {
  try {
    process.kill(pid, 0); // signal 0 only checks the process exists
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists, owned by someone else
  }
}

type Running = ActiveInfo & { pid: number; cwd: string | null };

export async function activeSessions(): Promise<Map<string, Running>> {
  const out = new Map<string, Running>();
  const files = await fs.readdir(REGISTRY).catch(() => []);
  await Promise.all(
    files
      .filter((f) => /^\d+\.json$/.test(f))
      .map(async (f) => {
        try {
          const d = JSON.parse(await fs.readFile(path.join(REGISTRY, f), "utf8"));
          if (typeof d.sessionId !== "string" || typeof d.pid !== "number" || !isAlive(d.pid)) return;
          out.set(d.sessionId, {
            pid: d.pid,
            status: d.status === "busy" ? "busy" : "idle",
            entrypoint: d.entrypoint === "claude-desktop" ? "desktop" : "cli",
            startedAt: typeof d.startedAt === "number" ? d.startedAt : 0,
            byLens: isLensRun(d.pid) || undefined,
            cwd: typeof d.cwd === "string" ? d.cwd : null,
          });
        } catch {}
      }),
  );
  return out;
}

// True if `pid` is running and is a Claude process (pids get reused, e.g. after a reboot).
export async function isClaudeProcess(pid: number) {
  if (!isAlive(pid)) return false;
  const { stdout } = await promisify(execFile)("ps", ["-p", String(pid), "-o", "command="]).catch(() => ({ stdout: "" }));
  return /claude/i.test(stdout);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Stops the Claude CLI process that has this session open, like pressing Ctrl+C
// twice in the terminal. Desktop-app sessions are left to the app itself.
export async function endSession(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const run = (await activeSessions()).get(id);
  if (!run) return { ok: false, error: "This session isn't running." };
  if (run.entrypoint === "desktop") return { ok: false, error: "This session runs in the desktop app. End it there." };

  // The pid could have been reused by another program since the registry file was written.
  if (!(await isClaudeProcess(run.pid)))
    return { ok: false, error: "Couldn't confirm that process is Claude, so I left it alone." };

  process.kill(run.pid, "SIGTERM");
  for (let i = 0; i < 15 && isAlive(run.pid); i++) await sleep(200);
  if (isAlive(run.pid)) process.kill(run.pid, "SIGKILL");
  return { ok: true };
}
