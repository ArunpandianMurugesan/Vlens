import "server-only";
import { ClaudeProc } from "./runClaude";
import type { LiveState } from "./types";

// The main chat's Claude processes, one per session, kept open between
// replies like the desktop app does. That's what lets a background agent
// finish (and Claude tell you about it) while you carry on chatting.
//
// A process with nothing to do closes after a while; the next message starts
// a fresh one with --resume, so nothing is lost.

const IDLE_MS = 15 * 60_000;

interface Live {
  proc: ClaudeProc;
  mode: string; // the permission mode it's in, as far as we know
  model: string; // "" = CLI default
  extra: string; // the other args it started with (plugin dirs), to spot a change
}

const g = globalThis as { lensLive?: Map<ClaudeProc, Live>; lensLiveSweep?: ReturnType<typeof setInterval> };
const all = (g.lensLive ??= new Map());

const bySession = (id: string) => [...all.values()].find((l) => l.proc.sessionId === id && !l.proc.exited);

export function liveState(sessionId: string): LiveState | null {
  return bySession(sessionId)?.proc.snapshot() ?? null;
}

// Stops what Claude is doing on its own in this session (not the process).
export async function interruptLive(sessionId: string) {
  const l = bySession(sessionId);
  return l ? l.proc.control({ subtype: "interrupt" }) : false;
}

// Stops one background agent or command, leaving the rest (and the reply) alone.
export async function stopLiveTask(sessionId: string, taskId: string) {
  const l = bySession(sessionId);
  return l ? l.proc.control({ subtype: "stop_task", task_id: taskId }) : false;
}

// Ends the session's open process so something else can take the session
// (the terminal, /compact). "busy" when Claude is still working in it.
export async function releaseLive(sessionId: string): Promise<"none" | "closed" | "busy"> {
  const l = bySession(sessionId);
  if (!l) return "none";
  if (!l.proc.idle) return "busy";
  await new Promise<void>((done) => {
    l.proc.onExit(done);
    l.proc.close();
    setTimeout(done, 6_000);
  });
  return "closed";
}

// The process to send this message to: the session's open one, switched to
// this message's mode and model, or a new one.
export async function procFor(o: {
  sessionId: string | null;
  cwd: string | null;
  mode: string;
  model: string;
  extra: string[];
  onSession?: (id: string) => void;
}): Promise<ClaudeProc> {
  const extra = JSON.stringify(o.extra);
  let l = o.sessionId ? bySession(o.sessionId) : undefined;
  // Settings changed the plugin dirs: start over, unless background work would be lost.
  if (l && l.extra !== extra && l.proc.idle) {
    l.proc.close();
    l = undefined;
  }
  if (l) {
    // Set the mode every time: approving a plan changes it inside the CLI.
    const okMode = await l.proc.control({ subtype: "set_permission_mode", mode: o.mode });
    const okModel = l.model === o.model || (await l.proc.control({ subtype: "set_model", model: o.model || "default" }));
    if (okMode && okModel) {
      l.mode = o.mode;
      l.model = o.model;
      return l.proc;
    }
    if (l.proc.idle) {
      l.proc.close();
      l = undefined;
    } else return l.proc; // keep the background work; this message goes out as it is
  }
  const args = [
    ...(o.sessionId ? ["--resume", o.sessionId] : []),
    "--permission-mode", o.mode,
    ...(o.model ? ["--model", o.model] : []),
    ...o.extra,
  ];
  // "vlens": your chats show up in the terminal's `claude --resume` list too.
  const proc = new ClaudeProc(args, o.cwd, o.sessionId, { onSession: o.onSession, entrypoint: "vlens" });
  all.set(proc, { proc, mode: o.mode, model: o.model, extra });
  proc.onExit(() => all.delete(proc));
  sweep();
  return proc;
}

// Close processes that have been idle for a while.
function sweep() {
  g.lensLiveSweep ??= setInterval(() => {
    for (const l of all.values()) if (l.proc.idle && Date.now() - l.proc.idleSince > IDLE_MS) l.proc.close();
  }, 60_000);
}

// Don't leave them running when the server stops.
const p = process as NodeJS.Process & { lensLiveHooked?: boolean };
if (!p.lensLiveHooked) {
  p.lensLiveHooked = true;
  process.on("exit", () => {
    for (const l of all.values()) if (!l.proc.exited) l.proc.child.kill("SIGTERM");
  });
}
