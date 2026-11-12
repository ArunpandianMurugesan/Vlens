"use client";

import "@xterm/xterm/css/xterm.css";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { FolderOpen, Loader2, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useFiles } from "./FileContext";

// A real shell beside the chat (like the file panel). Each session gets its own
// shell; it keeps running while the panel is hidden or you look at another
// session, and comes back as it was.
//
// The terminal itself stays alive too: switching back just moves it into view
// again, instead of building a new one and replaying all of its output. It
// draws with the GPU (WebGL), falling back to the slower DOM renderer.

const KEY = "lens.terminals"; // session (or folder, before it has one) -> shell id, for this window
const ids = (): Record<string, string> => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};
const remember = (owner: string, id: string | null) => {
  try {
    const m = ids();
    if (id) m[owner] = id;
    else delete m[owner];
    sessionStorage.setItem(KEY, JSON.stringify(m));
  } catch {}
};

const XTERM_VERSION = "6.0.0"; // @xterm/xterm in package.json

// The server closes the socket with 4000 + the exit code when the shell ends (lib/terminals.ts).
const EXIT_BASE = 4000;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

interface Shell {
  el: HTMLDivElement; // the terminal's own element, moved into whichever panel shows it
  term?: Terminal;
  fit?: FitAddon;
  ws?: WebSocket;
  ended: number | null;
  err: string | null;
  ready: boolean; // has printed something yet
  dispose: () => void;
}

// One per session, for as long as the page is open.
const shells = new Map<string, Shell>();
const listeners = new Set<() => void>();
let version = 0;
const changed = () => {
  version++;
  for (const l of listeners) l();
};

function openShell(owner: string, cwd: string | null, resume: string | null = null): Shell {
  const el = document.createElement("div");
  el.style.height = "100%";
  let gone = false;
  const s: Shell = {
    el,
    ended: null,
    err: null,
    ready: false,
    dispose: () => {
      gone = true;
      s.ws?.close();
      s.term?.dispose();
    },
  };
  (async () => {
    const [{ Terminal }, { FitAddon }, { WebglAddon }] = await Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
      import("@xterm/addon-webgl"),
    ]);
    if (gone) return;
    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12.5,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 5000,
      theme: { background: css("--term-bg"), foreground: css("--term-text"), cursor: css("--accent") },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    try {
      const gl = new WebglAddon();
      gl.onContextLoss(() => gl.dispose()); // back to the DOM renderer if the GPU drops it
      term.loadAddon(gl);
    } catch {}
    // Answer "which terminal are you?" (XTVERSION, CSI > q), which xterm.js
    // leaves unanswered. claude asks it to pick its mouse-wheel handling, and
    // without a reply it treats this as an unknown terminal: jumpy scrolling.
    term.parser.registerCsiHandler({ prefix: ">", final: "q" }, (params) => {
      if (((params[0] as number | undefined) ?? 0) !== 0) return false;
      if (s.ws?.readyState === WebSocket.OPEN) s.ws.send(`\x1bP>|xterm.js(${XTERM_VERSION})\x1b\\`);
      return true;
    });
    s.term = term;
    s.fit = fit;
    if (el.isConnected && el.offsetWidth) fit.fit();

    // This session's shell if it's still running, or a new one; then its socket.
    const res = await fetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ids()[owner] ?? null, cwd, cols: term.cols, rows: term.rows, resume }),
    });
    const t = (await res.json()) as { id: string; port: number; token: string; error?: string };
    if (!res.ok) throw new Error(t.error ?? res.statusText);
    if (gone) return;
    remember(owner, t.id);
    const ws = new WebSocket(`ws://127.0.0.1:${t.port}/?id=${t.id}&token=${t.token}`);
    s.ws = ws;
    ws.onopen = () => {
      sendSize(s);
      if (el.isConnected) term.focus(); // ready to type as soon as the shell is there
    };
    // Paint at most once a frame, with everything that came in since the last one,
    // so a screen that arrives in pieces is never drawn half done.
    let incoming = "";
    let frame = 0;
    const paint = () => {
      frame = 0;
      const out = incoming;
      incoming = "";
      if (out && !gone) term.write(out);
    };
    ws.onmessage = (e) => {
      incoming += e.data as string;
      // A hidden page gets no animation frames: write right away there.
      if (document.hidden) paint();
      else frame ||= requestAnimationFrame(paint);
      if (!s.ready) {
        s.ready = true;
        changed();
      }
    };
    ws.onclose = (e) => {
      if (gone) return;
      if (frame) cancelAnimationFrame(frame);
      paint(); // whatever came in last
      if (e.code >= EXIT_BASE && e.code < EXIT_BASE + 256) {
        remember(owner, null);
        if (owner.startsWith("cli:")) cliEnds.set(owner, Date.now());
        s.ended = e.code - EXIT_BASE;
      } else s.err = "Lost the connection to this terminal. Restart to open a new one.";
      changed();
    };
    term.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(d));
  })().catch((e) => {
    if (gone) return;
    s.err = `Couldn't open the terminal: ${(e as Error).message}`;
    changed();
  });
  return s;
}

function sendSize(s: Shell) {
  if (s.ws?.readyState === WebSocket.OPEN && s.term) s.ws.send("\0" + JSON.stringify({ cols: s.term.cols, rows: s.term.rows }));
}

function shellFor(owner: string, cwd: string | null, resume: string | null = null) {
  let s = shells.get(owner);
  if (!s) shells.set(owner, (s = openShell(owner, cwd, resume)));
  return s;
}

// Shows a shell in `host` while mounted (it stays alive when hidden), fitted to it.
function useShellIn(shell: Shell, box: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const host = box.current;
    if (!host) return;
    host.appendChild(shell.el);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refit = () => {
      if (!shell.fit || !host.offsetWidth) return;
      shell.fit.fit();
      sendSize(shell);
    };
    refit();
    shell.term?.focus();
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(refit, 50);
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      clearTimeout(timer);
      if (shell.el.parentElement === host) host.removeChild(shell.el);
    };
  }, [shell, box]);
}

const useShells = () =>
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => version,
    () => 0,
  );

// ---- A session's CLI view: `claude --resume <id>` in place of the chat. ----
// Only one of the two drives a session: switching back to Chat ends this claude.
const cliOwner = (sessionId: string) => `cli:${sessionId}`;
const cliEnds = new Map<string, number>(); // owner -> when its claude ended

// Did this session's CLI end just now? Until the next sessions refresh it still
// looks like "open in a terminal", and its last writes like someone else's.
export function cliEndedRecently(sessionId: string | null) {
  const at = sessionId ? cliEnds.get(cliOwner(sessionId)) : undefined;
  return !!at && Date.now() - at < 60_000;
}

// Is this session's CLI running (in this window)? Survives a page reload.
export function useCliOn(sessionId: string | null) {
  useShells();
  if (!sessionId) return false;
  const s = shells.get(cliOwner(sessionId));
  if (s) return s.ended === null; // an error stays on screen, with Back to chat
  return !!ids()[cliOwner(sessionId)];
}

export function startCli(sessionId: string, cwd: string | null) {
  const owner = cliOwner(sessionId);
  const old = shells.get(owner);
  if (old && (old.ended !== null || old.err)) {
    old.dispose(); // you quit it last time: start a fresh one
    shells.delete(owner);
  }
  shellFor(owner, cwd, sessionId);
  changed();
}

// Ends the CLI (the conversation is kept: claude writes each message as it goes).
export function stopCli(sessionId: string) {
  const owner = cliOwner(sessionId);
  const id = ids()[owner];
  cliEnds.set(owner, Date.now());
  remember(owner, null);
  shells.get(owner)?.dispose();
  shells.delete(owner);
  changed();
  return id ? fetch(`/api/terminal/${id}`, { method: "DELETE" }).then(() => {}).catch(() => {}) : Promise.resolve();
}

export function CliPane({ sessionId, cwd }: { sessionId: string; cwd: string | null }) {
  useShells();
  const box = useRef<HTMLDivElement>(null);
  const shell = shellFor(cliOwner(sessionId), cwd, sessionId);
  useShellIn(shell, box);
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-term text-term-ink">
      {shell.err && (
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5 text-xs text-term-ink/70">
          {shell.err}
          <button className="font-medium text-accent hover:underline" onClick={() => void stopCli(sessionId)}>
            Back to chat
          </button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <div ref={box} className="absolute inset-0 px-3 py-2" />
        {/* claude takes a second to draw its first screen: say so instead of a blank box. */}
        {!shell.ready && !shell.err && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-xs text-term-ink/60">
            <Loader2 size={13} className="animate-spin" /> Starting claude…
          </div>
        )}
      </div>
    </section>
  );
}

// Types a command into this session's shell (starting it if needed), as if you had.
export function runInTerminal(owner: string, cwd: string | null, line: string) {
  const s = shellFor(owner, cwd);
  const started = Date.now();
  const go = () => {
    if (s.ws?.readyState === WebSocket.OPEN) s.ws.send(line + "\r");
    else if (Date.now() - started < 15_000 && !s.err) setTimeout(go, 100);
  };
  go();
}

// owner: the session the shell belongs to (its folder while it's still a draft).
export function TerminalPanel({ owner, cwd }: { owner: string; cwd: string | null }) {
  const files = useFiles()!;
  const box = useRef<HTMLDivElement>(null);
  useShells();
  const folder = cwd ?? "~";
  const shell = shellFor(owner, cwd);
  useShellIn(shell, box);

  const restart = () => {
    const id = ids()[owner];
    if (id) void fetch(`/api/terminal/${id}`, { method: "DELETE" });
    remember(owner, null);
    shell.dispose();
    shells.delete(owner);
    changed();
  };

  const icon = "rounded-md p-1.5 text-term-ink/60 hover:bg-white/10 hover:text-term-ink";
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col bg-term text-term-ink">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-3 text-xs">
        <span className="font-medium">Terminal</span>
        <span className="flex min-w-0 items-center gap-1 truncate text-term-ink/60" title={folder}>
          <FolderOpen size={11} className="shrink-0" />
          <span className="truncate">{folder}</span>
        </span>
        <span className="ml-auto" />
        <button className={icon} onClick={restart} title="End this shell and start a new one" aria-label="Restart terminal">
          <RotateCcw size={13} />
        </button>
        <button className={icon} onClick={() => files.setTerminal(false)} title="Hide (the shell keeps running)" aria-label="Hide terminal">
          <X size={14} />
        </button>
      </div>
      {(shell.ended !== null || shell.err) && (
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5 text-xs text-term-ink/70">
          {shell.err ?? `The shell ended (code ${shell.ended}).`}
          <button className="font-medium text-accent hover:underline" onClick={restart}>
            Start a new one
          </button>
        </div>
      )}
      <div ref={box} className="min-h-0 flex-1 px-2 py-1.5" />
    </section>
  );
}
