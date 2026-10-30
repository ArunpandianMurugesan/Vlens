import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { spawn as spawnPty, type IPty } from "node-pty";

// Shells for the terminal panel. Each one is a real pty (like Terminal.app), so
// colours, prompts, vim and `claude` itself all work. The window streams its
// output and sends keys back. A shell outlives a page reload: the last output
// is kept so the panel can redraw it when it reconnects.
interface Term {
  pty: IPty;
  cwd: string;
  backlog: string; // the last output, replayed on reconnect
  listeners: Set<(e: TermEvent) => void>;
  exited: number | null;
}
export type TermEvent = { type: "data"; data: string } | { type: "exit"; code: number };

const BACKLOG = 200_000; // characters
const g = globalThis as { lensTerms?: Map<string, Term> };
const terms = (g.lensTerms ??= new Map());

export function openTerminal(cwd: string | null, cols: number, rows: number) {
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>;
  delete env.CLAUDECODE; // a `claude` started here is a normal top-level session
  delete env.ELECTRON_RUN_AS_NODE; // the packaged server runs as Electron-as-node; the shell shouldn't
  const shell = process.env.SHELL || "/bin/zsh";
  const pty = spawnPty(shell, ["-l"], { name: "xterm-256color", cols: fit(cols, 80), rows: fit(rows, 24), cwd: dir, env });
  const id = randomUUID();
  const t: Term = { pty, cwd: dir, backlog: "", listeners: new Set(), exited: null };
  pty.onData((data) => {
    t.backlog = (t.backlog + data).slice(-BACKLOG);
    for (const l of t.listeners) l({ type: "data", data });
  });
  pty.onExit(({ exitCode }) => {
    t.exited = exitCode;
    for (const l of t.listeners) l({ type: "exit", code: exitCode });
    // Keep it a moment so a reconnecting panel still learns that it ended.
    setTimeout(() => terms.delete(id), 30_000);
  });
  terms.set(id, t);
  return { id, cwd: dir };
}

const fit = (n: number, fallback: number) => (Number.isFinite(n) && n > 1 ? Math.min(Math.floor(n), 1000) : fallback);

export const getTerminal = (id: string) => terms.get(id) ?? null;

export function writeTerminal(id: string, data: string) {
  const t = terms.get(id);
  if (!t || t.exited !== null) return false;
  t.pty.write(data);
  return true;
}

export function resizeTerminal(id: string, cols: number, rows: number) {
  const t = terms.get(id);
  if (!t || t.exited !== null) return false;
  t.pty.resize(fit(cols, t.pty.cols), fit(rows, t.pty.rows));
  return true;
}

export function closeTerminal(id: string) {
  const t = terms.get(id);
  if (!t) return;
  if (t.exited === null) t.pty.kill();
  terms.delete(id);
}

// Close every shell when the server stops, so none are left running.
const p = process as NodeJS.Process & { lensTermsHooked?: boolean };
if (!p.lensTermsHooked) {
  p.lensTermsHooked = true;
  process.on("exit", () => {
    for (const t of terms.values()) if (t.exited === null) t.pty.kill();
  });
}
