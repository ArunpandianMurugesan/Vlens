"use client";

import { FileCode, Loader2, Minimize2, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { TreeChat } from "@/hooks/useTreeChat";
import type { LimitWindow } from "@/lib/types";
import { useFiles } from "./FileContext";
import { Ring } from "./Usage";

// The inspector beside a session's chat: how full its context is (and Compact),
// the files it edited, your plan usage, and its terminal. Toggled from the chat
// header (remembered in this browser).

export const INSPECTOR_KEY = "lens.inspector";
export const INSPECTOR_EVENT = "lens:inspector";

// Shown or not, shared by the header button and the panel.
export function useInspector() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    try {
      setOn(localStorage.getItem(INSPECTOR_KEY) !== "off");
    } catch {}
    const sync = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(INSPECTOR_EVENT, sync);
    return () => window.removeEventListener(INSPECTOR_EVENT, sync);
  }, []);
  const set = useCallback((v: boolean) => {
    try {
      localStorage.setItem(INSPECTOR_KEY, v ? "on" : "off");
    } catch {}
    window.dispatchEvent(new CustomEvent(INSPECTOR_EVENT, { detail: v }));
  }, []);
  return [on, set] as const;
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));
const until = (unix: number) => {
  const m = Math.round((unix * 1000 - Date.now()) / 60_000);
  return m <= 0 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const Heading = ({ children }: { children: React.ReactNode }) => <div className="text-[0.7rem] font-semibold text-muted">{children}</div>;

type Change = { path: string; add: number; del: number; state: "changed" | "new" | "edited" | "committed" };

export function Inspector({ chat }: { chat: TreeChat }) {
  const files = useFiles();
  const s = chat.session;
  const id = s?.id ?? null;
  const busy = !!s?.active && s.active.status === "busy";
  const [changes, setChanges] = useState<{ id: string; list: Change[]; repo: string | null } | null>(null);
  const [compact, setCompact] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [allFiles, setAllFiles] = useState(false);

  // The files it edited: again after each reply, and now and then while it works.
  const lastAt = s?.updatedAt;
  useEffect(() => {
    if (!id) return;
    let stop = false;
    const load = () =>
      fetch(`/api/sessions/${id}/changes`)
        .then((r) => r.json())
        .then((d) => !stop && setChanges({ id, list: d.files ?? [], repo: d.repo ?? null }))
        .catch(() => {});
    void load();
    const t = busy ? setInterval(load, 15_000) : undefined;
    return () => {
      stop = true;
      if (t) clearInterval(t);
    };
  }, [id, lastAt, busy]);
  useEffect(() => {
    setCompact({ busy: false, error: null });
    setAllFiles(false);
  }, [id]);

  if (!s) return null;
  const ctx = s.context;
  const pct = ctx ? ctx.used / ctx.window : 0;
  const elsewhere = s.active && !s.active.byLens ? (s.active.entrypoint === "desktop" ? "the desktop app" : "a terminal") : null;
  const runCompact = async () => {
    setCompact({ busy: true, error: null });
    const r = await fetch(`/api/sessions/${s.id}/context`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "compact" }) })
      .then((x) => x.json())
      .catch(() => ({ error: "Couldn't reach Vlens." }));
    setCompact({ busy: false, error: r.error ?? null });
  };
  const list = changes?.id === id ? changes.list : null;
  const open = (list ?? []).filter((c) => c.state !== "committed");
  const done = (list ?? []).filter((c) => c.state === "committed");
  const shown = allFiles ? [...open, ...done] : open.slice(0, 10);
  const w = chat.limits?.windows;

  return (
    <aside aria-label="Inspector" className="hidden w-72 shrink-0 flex-col gap-5 overflow-y-auto border-l border-line bg-sunken/40 px-4 pb-4 pt-14 scroll-thin xl:flex">

      <section className="space-y-2">
        <Heading>Context</Heading>
        {ctx ? (
          <>
            <div className="flex items-center gap-3">
              <Ring pct={pct} size={36} stroke={4} />
              <div>
                <div className="text-sm font-semibold">
                  {ctx.estimated ? "~" : ""}
                  {Math.round(pct * 100)}% used
                </div>
                <div className="text-xs text-muted">
                  {k(ctx.used)} of {k(ctx.window)} tokens
                </div>
              </div>
            </div>
            <button
              onClick={() => void runCompact()}
              disabled={compact.busy || busy || !!elsewhere}
              title={elsewhere ? `Open in ${elsewhere}. Use /compact there.` : busy ? "Wait for the reply to finish." : "Squeeze the conversation into a summary and keep going (/compact)"}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-bg px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
            >
              {compact.busy ? <Loader2 size={11} className="animate-spin" /> : <Minimize2 size={11} />} Compact
            </button>
            {pct > 0.5 && !compact.busy && <p className="text-[0.7rem] text-muted">Past half full: compact before the next big step.</p>}
            {compact.error && <p className="text-[0.7rem] text-red-600">{compact.error}</p>}
          </>
        ) : (
          <p className="text-xs text-muted">Shows after its first reply.</p>
        )}
      </section>

      <section className="space-y-1.5">
        <Heading>Files changed</Heading>
        {list === null ? (
          <Loader2 size={12} className="animate-spin text-muted" />
        ) : !list.length ? (
          <p className="text-xs text-muted">It hasn&apos;t edited any files.</p>
        ) : (
          <>
            {shown.map((c) => (
              <button
                key={c.path}
                onClick={() => files?.open(c.path.startsWith("/") || !changes?.repo ? c.path : `${changes.repo}/${c.path}`)}
                title={c.path}
                className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left font-mono text-[0.7rem] hover:bg-panel"
              >
                <FileCode size={11} className="shrink-0 text-muted" />
                <span className={`min-w-0 flex-1 truncate ${c.state === "committed" ? "text-muted" : ""}`}>{c.path.split("/").slice(-2).join("/")}</span>
                {c.state === "new" ? (
                  <span className="text-emerald-600">new</span>
                ) : c.state === "committed" ? (
                  <span className="text-muted">committed</span>
                ) : (
                  <>
                    {c.add > 0 && <span className="text-emerald-600">+{c.add}</span>}
                    {c.del > 0 && <span className="text-red-500">−{c.del}</span>}
                  </>
                )}
              </button>
            ))}
            {!open.length && !allFiles && <p className="text-xs text-muted">All {done.length} committed.</p>}
            {(open.length > 10 || done.length > 0) && (
              <button onClick={() => setAllFiles((v) => !v)} className="text-[0.7rem] text-muted hover:text-accent">
                {allFiles ? "Show fewer" : `Show all ${list.length}`}
              </button>
            )}
          </>
        )}
      </section>

      <section className="space-y-2">
        <Heading>Plan usage</Heading>
        {w ? (
          <>
            <Bar label="5 hours" w={w.fiveHour} />
            <Bar label="Week" w={w.sevenDay} />
          </>
        ) : (
          <p className="text-xs text-muted">No data yet.</p>
        )}
      </section>

      {files && (
        <section className="space-y-1.5">
          <Heading>Terminal</Heading>
          <button
            onClick={() => files.setTerminal((t) => !t)}
            className="flex w-full items-center gap-2 rounded-lg bg-term px-3 py-2 text-left font-mono text-[0.7rem] text-[#e8e2d4] hover:opacity-90"
            title="A shell in this session's folder (Ctrl+`)"
          >
            <Terminal size={12} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{files.terminal ? "Hide terminal" : `$ cd ${(s.cwd ?? "~").replace(/^\/Users\/[^/]+/, "~")}`}</span>
          </button>
        </section>
      )}
    </aside>
  );
}

function Bar({ label, w }: { label: string; w: LimitWindow | null }) {
  if (!w) return null;
  const pct = Math.round(w.utilization * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted">
          {pct}% · resets {until(w.resetsAt)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-line">
        <div className={`h-1.5 rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-amber-500" : "bg-accent"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}
