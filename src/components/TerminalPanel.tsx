"use client";

import "@xterm/xterm/css/xterm.css";
import type { Terminal } from "@xterm/xterm";
import { FolderOpen, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFiles } from "./FileContext";

// A real shell in the session's folder, beside the chat (like the file panel).
// Each folder gets its own shell; it keeps running while the panel is hidden
// or you look at another session, and comes back with its output on reopen.

const KEY = "lens.terminals"; // folder -> shell id, for this window
const ids = (): Record<string, string> => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};
const remember = (cwd: string, id: string | null) => {
  try {
    const m = ids();
    if (id) m[cwd] = id;
    else delete m[cwd];
    sessionStorage.setItem(KEY, JSON.stringify(m));
  } catch {}
};

// The server closes the socket with 4000 + the exit code when the shell ends (lib/terminals.ts).
const EXIT_BASE = 4000;

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function TerminalPanel({ cwd }: { cwd: string | null }) {
  const files = useFiles()!;
  const box = useRef<HTMLDivElement>(null);
  const [ended, setEnded] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [run, setRun] = useState(0); // bump to start a fresh shell
  const folder = cwd ?? "~";

  useEffect(() => {
    let gone = false;
    let term: Terminal | null = null;
    let ws: WebSocket | null = null;
    const cleanups: (() => void)[] = [];
    setEnded(null);
    setErr(null);

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (gone || !box.current) return;
      term = new Terminal({
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        fontSize: 12.5,
        cursorBlink: true,
        allowProposedApi: true,
        scrollback: 5000,
        theme: { background: css("--term-bg"), foreground: css("--term-text"), cursor: css("--accent") },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(box.current);
      fit.fit();

      // This folder's shell if it's still running, or a new one; then its socket.
      const res = await fetch("/api/terminal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: ids()[folder] ?? null, cwd, cols: term.cols, rows: term.rows }),
      });
      const t = (await res.json()) as { id: string; port: number; token: string; error?: string };
      if (!res.ok) throw new Error(t.error ?? res.statusText);
      if (gone) return;
      remember(folder, t.id);
      ws = new WebSocket(`ws://127.0.0.1:${t.port}/?id=${t.id}&token=${t.token}`);
      const size = () => ws?.readyState === WebSocket.OPEN && term && ws.send("\0" + JSON.stringify({ cols: term.cols, rows: term.rows }));
      ws.onopen = () => {
        size();
        term?.focus(); // ready to type as soon as the shell is there
      };
      ws.onmessage = (e) => term?.write(e.data as string);
      ws.onclose = (e) => {
        if (gone) return;
        if (e.code >= EXIT_BASE && e.code < EXIT_BASE + 256) {
          remember(folder, null);
          setEnded(e.code - EXIT_BASE);
        } else setErr("Lost the connection to this terminal. Restart to open a new one.");
      };
      term.onData((d) => ws?.readyState === WebSocket.OPEN && ws.send(d));

      let timer: ReturnType<typeof setTimeout> | undefined;
      const ro = new ResizeObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!term || !box.current?.offsetWidth) return;
          fit.fit();
          size();
        }, 50);
      });
      ro.observe(box.current);
      cleanups.push(() => ro.disconnect());
    })().catch((e) => {
      if (!gone) setErr(`Couldn't open the terminal: ${(e as Error).message}`);
    });

    return () => {
      gone = true;
      ws?.close();
      for (const c of cleanups) c();
      term?.dispose();
    };
  }, [folder, cwd, run]);

  const restart = () => {
    const id = ids()[folder];
    if (id) void fetch(`/api/terminal/${id}`, { method: "DELETE" });
    remember(folder, null);
    setRun((n) => n + 1);
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
      {(ended !== null || err) && (
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-1.5 text-xs text-term-ink/70">
          {err ?? `The shell ended (code ${ended}).`}
          <button className="font-medium text-accent hover:underline" onClick={restart}>
            Start a new one
          </button>
        </div>
      )}
      <div ref={box} className="min-h-0 flex-1 px-2 py-1.5" />
    </section>
  );
}
