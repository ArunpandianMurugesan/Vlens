"use client";

import { FolderChip, lastFolder, rememberFolder } from "./FolderChip";
import { BellRing, GitBranch, Loader2, Minimize2, Play, Sparkles } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { RootMode, TreeChat } from "@/hooks/useTreeChat";
import { PERMISSION_MODES } from "@/lib/modes";
import { MODELS } from "@/lib/models";
import type { DashboardData, HeavySession, ImageInput, SessionSummary } from "@/lib/types";
import { Composer } from "./Composer";
import { Ring } from "./Usage";
import { MenuButton } from "./Sidebar";

const fmt = (n: number) =>
  n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

function until(unixSec: number) {
  const s = unixSec - Date.now() / 1000;
  if (s <= 0) return "now";
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// ── Context health ──

function HeavyRow({ h, chat, onDone }: { h: HeavySession; chat: TreeChat; onDone: () => void }) {
  const [busy, setBusy] = useState<"compact" | "fresh" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pct = h.used / h.window;
  const blocked = h.active ? `Open in ${h.activeWhere === "desktop" ? "the desktop app" : "a terminal"}. Use /compact there, or close it first.` : null;

  const run = async (action: "compact" | "handoff") => {
    setBusy(action === "compact" ? "compact" : "fresh");
    setErr(null);
    try {
      const res = await fetch(`/api/sessions/${h.id}/context`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? res.statusText);
      if (action === "handoff") {
        // Start a new session in the same folder from the handoff note.
        const intro = `Continuing from an earlier session ("${h.title}"). Here's the handoff note it wrote:\n\n${d.note}\n\nRead it, check the current state of the code if you need to, then tell me briefly where things stand and what you'd do next.`;
        void chat.sendRoot(intro, "acceptEdits", undefined, [], d.cwd ?? h.cwd ?? undefined);
      } else onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  };

  const btn = "inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-line disabled:hover:text-inherit";
  return (
    <li className="border-t border-line py-2.5 first:border-t-0">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Ring pct={pct} size={34} stroke={4} />
          <span className="absolute inset-0 flex items-center justify-center text-[0.6rem] font-medium tabular-nums">{Math.round(pct * 100)}%</span>
        </div>
        <div className="min-w-0 flex-1">
          <button onClick={() => chat.selectSession(h.id)} className="block max-w-full truncate text-left text-sm hover:text-accent">
            {h.title}
          </button>
          <div className="truncate text-xs text-muted">
            {h.projectName} · {fmt(h.used)} of {fmt(h.window)}{h.estimated ? " (est.)" : ""} per reply · {h.replies} replies
            {h.compactions ? ` · compacted ${h.compactions}×` : ""} · {ago(h.updatedAt)}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button className={btn} disabled={!!busy || !!blocked} title={blocked ?? "Summarize this conversation in place (/compact)"} onClick={() => run("compact")}>
            {busy === "compact" ? <Loader2 size={12} className="animate-spin" /> : <Minimize2 size={12} />} Compact
          </button>
          <button className={btn} disabled={!!busy || !!blocked} title={blocked ?? "Write a handoff note, then start a new session in the same folder from it"} onClick={() => run("handoff")}>
            {busy === "fresh" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Fresh start
          </button>
        </div>
      </div>
      {busy && (
        <p className="mt-1.5 pl-[46px] text-xs text-muted">
          {busy === "compact" ? "Compacting… this can take a minute on a long session." : "Writing a handoff note… then a new session opens."}
        </p>
      )}
      {err && <p className="mt-1.5 pl-[46px] text-xs text-red-600">{err}</p>}
    </li>
  );
}


// ── Page: the start screen ──
//
// Home inside the Sessions space: say what Claude should do and in which folder,
// right here. Under it, what needs you, what's running and what you were in last,
// a strip of today's numbers, and sessions getting heavy (Compact / Fresh start).

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");

function Row({ s, onOpen, right }: { s: SessionSummary; onOpen: () => void; right?: ReactNode }) {
  const dot = s.active?.waitingFor ? "bg-amber-500" : s.active?.status === "busy" ? "bg-emerald-500 animate-pulse" : s.active ? "border-[1.5px] border-emerald-500" : "bg-line";
  const where = s.active ? (s.active.entrypoint === "desktop" ? "desktop app" : s.active.byLens ? "Vlens" : "terminal") : null;
  return (
    <li>
      <button onClick={onOpen} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-sunken">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
        <span className="shrink-0 truncate text-xs text-muted">
          {[s.projectName, where].filter(Boolean).join(" · ")}
        </span>
        {right ?? <span className="w-14 shrink-0 text-right text-xs text-muted">{ago(s.updatedAt).replace(" ago", "")}</span>}
      </button>
    </li>
  );
}

function Group({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1 flex items-center gap-1.5 px-2.5 text-xs font-semibold text-muted">
        {icon}
        {title}
      </h2>
      <ul>{children}</ul>
    </section>
  );
}

export function HomeView({ chat, onMenu, onNew, onReview }: { chat: TreeChat; onMenu: () => void; onNew: () => void; onReview: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const load = useCallback(async () => {
    setData(await fetch("/api/dashboard").then((r) => r.json()).catch(() => null));
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  // Folders you worked in, most recent first; the one you used last here is picked.
  const folders = useMemo(() => {
    const seen: string[] = [];
    for (const s of [...chat.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))) if (s.cwd && !seen.includes(s.cwd)) seen.push(s.cwd);
    return seen.slice(0, 15);
  }, [chat.sessions]);
  const [folder, setFolder] = useState<string>("");
  useEffect(() => {
    if (folder) return;
    const saved = lastFolder();
    if (saved || folders[0]) setFolder(saved || folders[0]);
  }, [folders, folder]);
  const pick = (f: string) => {
    setFolder(f);
    rememberFolder(f);
  };
  const [mode, setMode] = useState<RootMode | null>(null);
  const curMode = mode ?? chat.settings?.cliMode ?? "default";
  const [model, setModel] = useState<string | null>(null);
  const curModel = model ?? chat.settings?.defaultModel ?? "";
  const send = (text: string, images: ImageInput[]) => {
    if (!folder || (!text.trim() && !images.length)) return;
    void chat.sendRoot(text, curMode, curModel, images, folder);
  };

  const people = chat.sessions.filter((s) => !s.archivedAt);
  const waiting = people.filter((s) => s.active?.waitingFor);
  const running = people.filter((s) => s.active && !s.active.waitingFor);
  const recent = people
    .filter((s) => !s.active)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 6);
  const open = (id: string) => chat.selectSession(id);
  const a = data?.account;
  const w = data?.limits.windows;
  const today = data?.days.at(-1)?.stats;
  const heavy = (data?.heavy ?? []).filter((h) => h.used / h.window >= 0.5).slice(0, 3);
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();
  const sel = "rounded-lg bg-sunken px-1.5 py-0.5 text-[0.7rem] text-muted outline-none hover:text-ink";

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <MenuButton onClick={onMenu} />
        <h1 className="flex-1 text-sm font-semibold">Home</h1>
        <button onClick={onReview} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent">
          <GitBranch size={12} /> Vlens Review
        </button>
      </header>

      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-3xl space-y-7 px-6 pb-10 pt-[9vh]">
          <div className="space-y-1 text-center">
            <div className="text-2xl font-semibold">
              {greeting}
              {a?.email ? `, ${a.email.split("@")[0]}` : ""}
            </div>
            <p className="text-sm text-muted">What should Claude do?</p>
          </div>

          <div className="space-y-2">
            <Composer
              placeholder={folder ? `What should Claude do in ${home(folder).split("/").pop()}?` : "Pick a folder first"}
              disabled={!folder}
              running={false}
              cwd={folder || null}
              onSend={send}
              onQueue={send}
              onShiftTab={() => setMode(PERMISSION_MODES[(PERMISSION_MODES.findIndex((m) => m.id === curMode) + 1) % PERMISSION_MODES.length].id)}
              onStop={() => {}}
              footer={
                <div className="flex flex-wrap items-center gap-2">
                  <FolderChip value={folder} onChange={pick} recent={folders} down />
                  <select value={curMode} onChange={(e) => setMode(e.target.value as RootMode)} aria-label="Permission mode" className={sel}>
                    {PERMISSION_MODES.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <select value={curModel} onChange={(e) => setModel(e.target.value)} aria-label="Model" className={sel}>
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              }
            />
            <p className="px-1 text-center text-[0.7rem] text-muted">
              ↩ to start · Shift+Tab for the mode · or <button onClick={onNew} className="underline hover:text-accent">open the full new-session page</button> for a worktree
            </p>
          </div>

          {waiting.length > 0 && (
            <Group title="Needs you" icon={<BellRing size={12} className="text-amber-600" />}>
              {waiting.map((s) => (
                <Row key={s.id} s={s} onOpen={() => open(s.id)} right={<span className="w-14 shrink-0 text-right text-xs font-semibold text-amber-700 dark:text-amber-400">{/plan/i.test(s.active!.waitingFor!) ? "plan" : "asks"}</span>} />
              ))}
            </Group>
          )}
          {running.length > 0 && (
            <Group title="Running now" icon={<Play size={12} />}>
              {running.map((s) => (
                <Row key={s.id} s={s} onOpen={() => open(s.id)} right={<span className="w-14 shrink-0 text-right text-xs text-muted">{s.active!.status === "busy" ? "working" : "open"}</span>} />
              ))}
            </Group>
          )}
          {recent.length > 0 && (
            <Group title="Recent">
              {recent.map((s) => (
                <Row key={s.id} s={s} onOpen={() => open(s.id)} />
              ))}
            </Group>
          )}

          {heavy.length > 0 && data && (
            <section>
              <h2 className="mb-1 flex items-center gap-1.5 px-2.5 text-xs font-semibold text-muted">
                <Minimize2 size={12} /> Getting heavy
                <span className="font-normal">· past half full, so every reply re-sends a lot</span>
              </h2>
              <ul className="rounded-xl border border-line px-3">
                {heavy.map((h) => (
                  <HeavyRow key={h.id} h={h} chat={chat} onDone={load} />
                ))}
              </ul>
            </section>
          )}

          {data && (
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t border-line pt-4 text-xs text-muted">
              {w?.fiveHour && <span>5 hours {Math.round(w.fiveHour.utilization * 100)}% · resets {until(w.fiveHour.resetsAt)}</span>}
              {w?.sevenDay && <span>Week {Math.round(w.sevenDay.utilization * 100)}% · resets {until(w.sevenDay.resetsAt)}</span>}
              <span>{today?.prompts ?? 0} messages today</span>
              <span>{fmt(today?.tokensSent ?? 0)} tokens read today</span>
              <span className="flex items-center gap-1">
                <Sparkles size={11} /> {data.counts.active} running · {data.counts.thisWeek} this week
              </span>
            </div>
          )}
          {!data && (
            <div className="flex justify-center text-muted">
              <Loader2 size={14} className="animate-spin" />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
