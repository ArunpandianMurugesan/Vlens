import "server-only";

// Process ids of the `claude -p` runs Lens itself started. Every running
// Claude registers in ~/.claude/sessions, but only these are Lens's own; any
// other process means the session is open in a terminal or the desktop app.
const g = globalThis as { lensRunPids?: Set<number> };
const pids = (g.lensRunPids ??= new Set());

export function trackRun(child: { pid?: number; once: (e: "close", cb: () => void) => unknown }) {
  if (!child.pid) return;
  const pid = child.pid;
  pids.add(pid);
  child.once("close", () => pids.delete(pid));
}

export const isLensRun = (pid: number) => pids.has(pid);
