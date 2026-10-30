import "server-only";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage } from "node:http";
import os from "node:os";
import { spawn as spawnPty, type IPty } from "node-pty";
import { WebSocketServer, type WebSocket } from "ws";

// Shells for the terminal panel. Each one is a real pty (like Terminal.app), so
// colours, prompts, vim and `claude` itself all work.
//
// Keys and output go over a WebSocket, not HTTP requests: a request per key
// felt sluggish (each one costs a round trip, and they queue). Next's routes
// can't hold a WebSocket, so a small server of its own listens on 127.0.0.1.
// The API (same-origin only, see middleware.ts) hands out each shell's port
// and a secret token; the socket needs both, and a local Origin.
//
// A shell outlives a page reload: its last output is kept, so the panel can
// redraw it when it reconnects.
interface Term {
  pty: IPty;
  cwd: string;
  token: string;
  backlog: string; // the last output, replayed on reconnect
  sockets: Set<WebSocket>;
  exited: number | null;
}

const BACKLOG = 200_000; // characters
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
// Closing the socket with this code + the exit code says the shell ended.
export const EXIT_CODE_BASE = 4000;

const g = globalThis as { lensTerms?: Map<string, Term>; lensTermServer?: Promise<number> };
const terms = (g.lensTerms ??= new Map());

// The WebSocket server, started on first use. Resolves to its port.
function server(): Promise<number> {
  return (g.lensTermServer ??= new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0, perMessageDeflate: false });
    wss.on("listening", () => resolve((wss.address() as { port: number }).port));
    wss.on("error", (e) => {
      g.lensTermServer = undefined;
      reject(e);
    });
    wss.on("connection", attach);
  }));
}

function attach(ws: WebSocket, req: IncomingMessage) {
  const url = new URL(req.url ?? "/", "http://x");
  const t = terms.get(url.searchParams.get("id") ?? "");
  const origin = req.headers.origin ?? "";
  const okOrigin = (() => {
    try {
      return LOCAL.test(new URL(origin).host);
    } catch {
      return false;
    }
  })();
  if (!t || !okOrigin || !same(url.searchParams.get("token") ?? "", t.token)) return ws.close(4401, "Not allowed");

  if (t.backlog) ws.send(t.backlog);
  if (t.exited !== null) return ws.close(EXIT_CODE_BASE + (t.exited & 0xff), "exited");
  t.sockets.add(ws);
  // From the panel: a string is keys; {"cols","rows"} (sent as JSON with a
  // leading NUL, which a keyboard can't type) is a resize.
  ws.on("message", (raw, isBinary) => {
    const s = isBinary ? Buffer.from(raw as Buffer).toString("utf8") : raw.toString();
    if (t.exited !== null) return;
    if (s.startsWith("\0")) {
      try {
        const { cols, rows } = JSON.parse(s.slice(1));
        t.pty.resize(fit(cols, t.pty.cols), fit(rows, t.pty.rows));
      } catch {}
    } else t.pty.write(s);
  });
  ws.on("close", () => t.sockets.delete(ws));
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const fit = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) && n > 1 ? Math.min(Math.floor(n), 1000) : fallback;

// A shell to connect to: the one with this id if it's still running, else a new one.
export async function openTerminal(o: { id?: string | null; cwd: string | null; cols: number; rows: number }) {
  const port = await server();
  const known = o.id ? terms.get(o.id) : undefined;
  if (known && known.exited === null) return { id: o.id!, cwd: known.cwd, port, token: known.token };

  const dir = o.cwd && fs.existsSync(o.cwd) ? o.cwd : os.homedir();
  const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" } as Record<string, string>;
  delete env.CLAUDECODE; // a `claude` started here is a normal top-level session
  delete env.ELECTRON_RUN_AS_NODE; // the packaged server runs as Electron-as-node; the shell shouldn't
  const shell = process.env.SHELL || "/bin/zsh";
  const pty = spawnPty(shell, ["-l"], { name: "xterm-256color", cols: fit(o.cols, 80), rows: fit(o.rows, 24), cwd: dir, env });
  const id = randomUUID();
  const t: Term = { pty, cwd: dir, token: randomBytes(24).toString("hex"), backlog: "", sockets: new Set(), exited: null };
  pty.onData((data) => {
    t.backlog = (t.backlog + data).slice(-BACKLOG);
    for (const ws of t.sockets) ws.send(data);
  });
  pty.onExit(({ exitCode }) => {
    t.exited = exitCode;
    for (const ws of t.sockets) ws.close(EXIT_CODE_BASE + (exitCode & 0xff), "exited");
    // Keep it a moment so a reconnecting panel still learns that it ended.
    setTimeout(() => terms.delete(id), 30_000);
  });
  terms.set(id, t);
  return { id, cwd: dir, port, token: t.token };
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
