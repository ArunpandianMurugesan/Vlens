"use client";

import "@xterm/xterm/css/xterm.css";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { FolderOpen, RotateCcw, X } from "lucide-react";
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

function openShell(owner: string, cwd: string | null): Shell {
  const el = document.createElement("div");
  el.style.height = "100%";
  let gone = false;
  const s: Shell = {
    el,
    ended: null,
    err: null,
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
    s.term = term;
    s.fit = fit;
    if (el.isConnected && el.offsetWidth) fit.fit();

    // This session's shell if it's still running, or a new one; then its socket.
    const res = await fetch("/api/terminal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: ids()[owner] ?? null, cwd, cols: term.cols, rows: term.rows }),
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
    ws.onmessage = (e) => term.write(e.data as string);
    ws.onclose = (e) => {
      if (gone) return;
      if (e.code >= EXIT_BASE && e.code < EXIT_BASE + 256) {
        remember(owner, null);
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

function shellFor(owner: string, cwd: string | null) {
  let s = shells.get(owner);
  if (!s) shells.set(owner, (s = openShell(owner, cwd)));
  return s;
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
  useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => version,
    () => 0,
  );
  const folder = cwd ?? "~";
  const shell = shellFor(owner, cwd);

  // Show this session's terminal here; it stays alive when hidden.
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
  }, [shell]);

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
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5 text-xs">
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
