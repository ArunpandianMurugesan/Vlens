"use client";

import { FolderOpen, History, Loader2, Menu, MessageSquare, Pin, PinOff, Play, Search, SquareTerminal } from "lucide-react";
import { useMemo, useState } from "react";
import type { TreeChat } from "@/hooks/useTreeChat";
import type { SessionSummary } from "@/lib/types";
import { ContextBadge } from "./Usage";

const DAYS = 15;
const DAY = 24 * 60 * 60 * 1000;

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function dayLabel(key: string) {
  const [y, m, dd] = key.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - d.getTime()) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// What you worked on in the last 15 days, by day: a session shows on every day
// it had messages (long sessions span weeks). Pick one up again here in Vlens
// (just type), or in a terminal with `claude --resume`.
export function HistoryView({ chat, onMenu, onOpen }: { chat: TreeChat; onMenu: () => void; onOpen: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const { days, total } = useMemo(() => {
    const since = dayKey(new Date(Date.now() - (DAYS - 1) * DAY));
    const needle = q.trim().toLowerCase();
    const byDay = new Map<string, { s: SessionSummary; count: number }[]>();
    const seen = new Set<string>();
    for (const s of chat.sessions) {
      if (needle && !`${s.title} ${s.cwd ?? s.projectName}`.toLowerCase().includes(needle)) continue;
      for (const [key, count] of Object.entries(s.days ?? {})) {
        if (key < since) continue;
        byDay.set(key, [...(byDay.get(key) ?? []), { s, count }]);
        seen.add(s.id);
      }
    }
    const days = [...byDay.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, list]) => ({ key, label: dayLabel(key), list: list.sort((a, b) => b.count - a.count) }));
    return { days, total: seen.size };
  }, [chat.sessions, q]);

  const toTerminal = async (id: string) => {
    setBusy(id);
    setErr(null);
    const res = await fetch(`/api/sessions/${id}/terminal`, { method: "POST" });
    if (!res.ok) setErr((await res.json().catch(() => null))?.error ?? "Couldn't open the terminal.");
    setBusy(null);
  };

  const btn = "inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-50";
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button onClick={onMenu} className="text-muted md:hidden" aria-label="Open sidebar">
          <Menu size={20} />
        </button>
        <h1 className="flex-1 font-medium">History</h1>
        <span className="text-xs text-muted">{total} sessions in the last {DAYS} days</span>
      </header>

      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-4xl space-y-5 px-4 py-6">
          <div>
            <p className="text-sm text-muted">
              What you worked on, day by day. A long session shows on each day you used it. <b className="text-ink">Resume here</b> opens it in Vlens (type to carry on), or continue it in a terminal.
            </p>
            <label className="mt-3 flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-sm">
              <Search size={14} className="text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or folder" className="w-full bg-transparent outline-none placeholder:text-muted" />
            </label>
            {err && <p className="mt-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{err}</p>}
          </div>

          {!chat.sessions.length ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Reading your sessions…
            </div>
          ) : !total ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center text-sm text-muted">
              <History size={22} />
              {q ? "No sessions match." : `No sessions in the last ${DAYS} days.`}
            </div>
          ) : (
            days.map(({ key, label, list }) => (
              <section key={key}>
                <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">{label}</h2>
                <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-panel">
                  {list.map(({ s, count }) => {
                    const pinned = s.pinOrder !== undefined;
                    const running = !!s.active && !s.active.byLens;
                    return (
                      <li key={`${key}-${s.id}`} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <button onClick={() => onOpen(s.id)} className="min-w-0 flex-1 text-left">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium hover:text-accent">{s.title}</span>
                            {running && <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] font-medium text-emerald-600">running in {s.active!.entrypoint === "desktop" ? "desktop app" : "terminal"}</span>}
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 truncate text-xs text-muted">
                            <span className="flex min-w-0 items-center gap-1 truncate" title={s.cwd ?? undefined}>
                              <FolderOpen size={11} className="shrink-0" /> {s.cwd?.split("/").filter(Boolean).slice(-2).join("/") ?? s.projectName}
                            </span>
                            <span className="flex shrink-0 items-center gap-1" title={`${count} messages this day, ${s.messageCount} in all`}>
                              <MessageSquare size={11} /> {count} that day
                            </span>
                            {dayKey(new Date(s.updatedAt)) === key && <span className="shrink-0">last at {time(new Date(s.updatedAt))}</span>}
                          </div>
                        </button>
                        <ContextBadge ctx={s.context} compact />
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button className={`${btn} border-accent/50 text-accent`} onClick={() => onOpen(s.id)}>
                            <Play size={11} /> {running ? "Open" : "Resume here"}
                          </button>
                          <button className={btn} disabled={busy === s.id || running} onClick={() => toTerminal(s.id)} title={running ? "Already open somewhere" : "Opens claude --resume in Terminal or iTerm"}>
                            {busy === s.id ? <Loader2 size={11} className="animate-spin" /> : <SquareTerminal size={11} />} Terminal
                          </button>
                          <button
                            className={btn}
                            onClick={() => void chat.pinSession(s.id, !pinned).catch((e: Error) => setErr(e.message))}
                            title={pinned ? "Unpin" : "Pin to the sidebar"}
                            aria-label={pinned ? "Unpin" : "Pin"}
                          >
                            {pinned ? <PinOff size={11} /> : <Pin size={11} />}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </div>
    </main>
  );
}
