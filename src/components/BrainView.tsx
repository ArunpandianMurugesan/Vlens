"use client";

import { ArrowLeft, Brain, History, Loader2, Pencil, Pin, PinOff, Plus, RotateCcw, Search, Sparkles, Trash2, X } from "lucide-react";
import { FolderChip } from "./FolderChip";
import { useCallback, useEffect, useState } from "react";
import type { Bot } from "@/lib/types";

// The Vlens brain (lib/brain): one shared memory of your work, for bots only.
// Here you see what it remembers, search it by meaning, and fix, pin or forget
// memories. Bots use it through their brain tools, when their bot.md switches it on.

type Kind = "decision" | "fact" | "howto" | "work" | "person" | "project";
type Memory = {
  id: string;
  title: string;
  text: string;
  kind: Kind;
  importance: number;
  tags: string[];
  pinned: boolean;
  sources: { type: string; id?: string; note?: string; at: string }[];
  updatedAt: string;
  uses: number;
  history: unknown[];
  match?: number;
  forgottenAt?: string;
  by?: string;
};
const KINDS: { id: Kind; label: string }[] = [
  { id: "decision", label: "Decisions" },
  { id: "fact", label: "Facts" },
  { id: "howto", label: "How-tos" },
  { id: "work", label: "Work items" },
  { id: "person", label: "People" },
  { id: "project", label: "Projects" },
];
const btn = "inline-flex items-center gap-1 rounded-lg border border-line bg-bg px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";
const ago = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d < 1 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
};
const from = (m: Memory, bots: Bot[]) => {
  const s = m.sources.at(-1);
  if (!s) return "";
  if (s.type === "you") return "you";
  if (s.type === "bot") return bots.find((b) => b.id === s.id)?.name ?? s.id ?? "a bot";
  return `a session${s.note ? ` (${s.note})` : ""}`;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? r.statusText);
  return d as T;
}

export function BrainView({ bots, onBack, onOpenBot, recentFolders }: { bots: Bot[]; onBack: () => void; onOpenBot: (id: string) => void; recentFolders: string[] }) {
  const [list, setList] = useState<Memory[] | null>(null);
  const [q, setQ] = useState("");
  const [asked, setAsked] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  const [forgotten, setForgotten] = useState(false);
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<"memories" | "activity">("memories");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const u = forgotten ? "/api/brain?forgotten=1" : `/api/brain?${new URLSearchParams({ ...(asked ? { q: asked } : {}), ...(kind ? { kind } : {}) })}`;
      setList((await api<{ memories: Memory[] }>(u)).memories);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  }, [asked, kind, forgotten]);
  useEffect(() => {
    void load();
  }, [load]);

  const users = bots.filter((b) => b.brain && b.brain !== "off");
  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-6 pr-16 md:pr-8 lg:px-8">
        <button onClick={onBack} className="inline-flex items-center gap-1 rounded-lg bg-sunken px-2.5 py-1 text-xs hover:text-accent">
          <ArrowLeft size={13} /> All bots
        </button>
        <header className="flex flex-wrap items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Brain size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold">Vlens brain</h1>
            <p className="text-xs text-muted">Shared memory of your work, for bots only. It stays on this Mac; your normal Claude sessions can&apos;t see it.</p>
          </div>
          <button onClick={() => setAdding((v) => !v)} className={btn}>
            <Plus size={12} /> Add a memory
          </button>
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <main className="space-y-3">
            <div className="flex gap-1 rounded-lg bg-sunken p-0.5 text-xs" role="tablist">
              {(
                [
                  ["memories", "Memories"],
                  ["activity", "What it learned"],
                ] as const
              ).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex-1 rounded-md px-3 py-1.5 ${tab === id ? "bg-bg font-medium shadow-sm" : "text-muted hover:text-ink"}`}>
                  {label}
                </button>
              ))}
            </div>
            {tab === "activity" ? (
              <Activity bots={bots} />
            ) : (
              <>
            {adding && <AddForm onDone={() => (setAdding(false), void load())} />}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setForgotten(false);
                setAsked(q.trim());
              }}
              className="flex items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 focus-within:border-accent"
            >
              <Search size={15} className="shrink-0 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Ask by meaning, e.g. "when should the consent banner show?"' className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
              {asked && (
                <button
                  type="button"
                  onClick={() => {
                    setQ("");
                    setAsked("");
                  }}
                  aria-label="Clear search"
                  className="text-muted hover:text-ink"
                >
                  <X size={14} />
                </button>
              )}
              <button className={btn}>{busy && asked ? <Loader2 size={12} className="animate-spin" /> : null} Search</button>
            </form>
            <div className="flex flex-wrap gap-1.5">
              <Chip on={!kind && !forgotten} onClick={() => (setKind(null), setForgotten(false))}>
                All
              </Chip>
              {KINDS.map((k) => (
                <Chip key={k.id} on={kind === k.id && !forgotten} onClick={() => (setKind(k.id), setForgotten(false))}>
                  {k.label}
                </Chip>
              ))}
              <span className="flex-1" />
              <Chip on={forgotten} onClick={() => setForgotten((v) => !v)}>
                Forgotten
              </Chip>
            </div>
            {err && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">{err}</p>}
            {list === null ? (
              <Loader2 size={16} className="animate-spin text-muted" />
            ) : !list.length ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
                {forgotten ? "Nothing forgotten." : asked ? "Nothing about that yet." : "The brain is empty. Bots fill it as they work, and you can add memories yourself."}
              </p>
            ) : (
              list.map((m) => <Row key={m.id} m={m} bots={bots} forgotten={forgotten} act={act} />)
            )}
              </>
            )}
          </main>

          <aside className="space-y-4">
            <Learning recentFolders={recentFolders} onChanged={() => void load()} />
            <section className="rounded-2xl border border-line bg-panel p-4">
              <h2 className="mb-2 text-sm font-semibold">Bots that use it</h2>
              {users.length ? (
                <ul className="space-y-1.5 text-sm">
                  {users.map((b) => (
                    <li key={b.id} className="flex items-center gap-2">
                      <button onClick={() => onOpenBot(b.id)} className="min-w-0 flex-1 truncate text-left hover:text-accent">
                        {b.name}
                      </button>
                      <span className="shrink-0 rounded-md bg-sunken px-1.5 py-0.5 text-[0.7rem] text-muted">{b.brain === "remember" ? "read and remember" : "read only"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">None yet. Switch it on in a bot&apos;s setup file: under Knows, &ldquo;brain: read only&rdquo; or &ldquo;brain: read and remember&rdquo;.</p>
              )}
            </section>
            <section className="rounded-2xl border border-line bg-panel p-4 text-[0.8rem] leading-relaxed text-muted">
              <h2 className="mb-1 text-sm font-semibold text-ink">How it works</h2>
              Search is by meaning, with a small model on this Mac. While you work, it reads new turns of your sessions in the folders above and keeps what matters (a small Claude call). When it&apos;s quiet, it merges duplicates and lets unused minor memories fade. Pinned memories are never touched; forgotten ones can be brought back.
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick} aria-pressed={on} className={`rounded-full border px-3 py-1 text-xs ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink"}`}>
    {children}
  </button>
);

function Row({ m, bots, forgotten, act }: { m: Memory; bots: Bot[]; forgotten: boolean; act: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [edit, setEdit] = useState(false);
  const [title, setTitle] = useState(m.title);
  const [text, setText] = useState(m.text);
  const url = `/api/brain/${m.id}`;
  return (
    <article className={`rounded-xl border bg-panel p-3.5 ${m.pinned ? "border-accent/50" : "border-line"}`}>
      {edit ? (
        <div className="space-y-2">
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm font-medium outline-none focus:border-accent" />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="w-full resize-y rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent" />
          <div className="flex gap-2">
            <button onClick={() => void act(() => api(url, { method: "PATCH", body: JSON.stringify({ title, text }) })).then(() => setEdit(false))} className={btn}>
              Save
            </button>
            <button onClick={() => (setEdit(false), setTitle(m.title), setText(m.text))} className="text-xs text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-sm font-semibold">{m.title}</h3>
                <span className="rounded-md bg-sunken px-1.5 py-0.5 text-[0.65rem] text-muted">{KINDS.find((k) => k.id === m.kind)?.label.replace(/s$/, "") ?? m.kind}</span>
                {m.pinned && <Pin size={11} className="text-accent" />}
                {m.match !== undefined && <span className="text-[0.65rem] text-muted">match {Math.round(m.match * 100)}%</span>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-[0.85rem] leading-relaxed">{m.text}</p>
            </div>
            {!forgotten ? (
              <div className="flex shrink-0 gap-0.5">
                <button onClick={() => void act(() => api(url, { method: "PATCH", body: JSON.stringify({ pinned: !m.pinned }) }))} title={m.pinned ? "Unpin" : "Pin: it never fades"} aria-label={m.pinned ? "Unpin" : "Pin"} className="rounded p-1 text-muted hover:text-ink">
                  {m.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                </button>
                <button onClick={() => setEdit(true)} title="Fix it" aria-label="Edit" className="rounded p-1 text-muted hover:text-ink">
                  <Pencil size={13} />
                </button>
                <button onClick={() => window.confirm(`Forget "${m.title}"? You can bring it back from Forgotten.`) && void act(() => api(url, { method: "DELETE" }))} title="Forget" aria-label="Forget" className="rounded p-1 text-muted hover:text-red-600">
                  <Trash2 size={13} />
                </button>
              </div>
            ) : (
              <button onClick={() => void act(() => api(url, { method: "PATCH", body: JSON.stringify({ restore: true }) }))} className={btn}>
                <RotateCcw size={12} /> Bring back
              </button>
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[0.7rem] text-muted">
            <span>From {from(m, bots)}</span>
            <span>Updated {ago(m.updatedAt)}</span>
            <span>Importance {Math.round(m.importance * 100)}%</span>
            {m.uses > 0 && <span>Used {m.uses}×</span>}
            {m.history.length > 0 && <span>{m.history.length} earlier version{m.history.length === 1 ? "" : "s"}</span>}
            {forgotten && m.forgottenAt && <span>Forgotten {ago(m.forgottenAt)} by {m.by?.startsWith("bot:") ? m.by.slice(4) : m.by}</span>}
          </div>
        </>
      )}
    </article>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<Kind>("fact");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/brain", { method: "POST", body: JSON.stringify({ title, text, kind, importance: 0.7 }) });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-xl border border-accent/40 bg-accent-soft/20 p-3.5">
      <div className="flex gap-2">
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title" className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent" />
        <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className="rounded-lg border border-line bg-bg px-2 text-sm outline-none">
          {KINDS.map((k) => (
            <option key={k.id} value={k.id}>
              {k.label.replace(/s$/, "")}
            </option>
          ))}
        </select>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="What should bots remember? Include the why." className="w-full resize-y rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent" />
      {err && <p className="text-xs text-red-600">{err}</p>}
      <button onClick={() => void save()} disabled={busy || !title.trim() || !text.trim()} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
        {busy && <Loader2 size={12} className="animate-spin" />} Remember it
      </button>
    </div>
  );
}

// ── Learning: from which sessions, and how it's doing ────────────────────────

type LearnState = {
  settings: { learn: boolean; folders: string[]; maxRunsPerDay: number };
  status: { running: boolean; lastRun: string | null; skipped: number; lastError: string | null; runsToday: number; watched: number; lastReflection: string | null };
  activity: ActivityEntry[];
};
type ActivityEntry = { id: string; at: string; kind: "learn" | "reflect"; session?: { id: string; title: string; folder: string | null }; ops: { op: string; id: string; title: string; why?: string }[]; note?: string };

function useLearn() {
  const [d, setD] = useState<LearnState | null>(null);
  const load = useCallback(() => api<LearnState>("/api/brain/learn").then(setD).catch(() => {}), []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15_000);
    return () => clearInterval(t);
  }, [load]);
  return { d, load };
}

const when = (iso: string | null) => (!iso ? "never" : new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));

function Learning({ recentFolders, onChanged }: { recentFolders: string[]; onChanged: () => void }) {
  const { d, load } = useLearn();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  if (!d) return <Loader2 size={14} className="animate-spin text-muted" />;
  const s = d.settings;
  const save = async (p: Partial<LearnState["settings"]>) => {
    await api("/api/brain/learn", { method: "PATCH", body: JSON.stringify(p) });
    await load();
  };
  const run = async (action: "learn" | "reflect") => {
    setBusy(action);
    await api("/api/brain/learn", { method: "POST", body: JSON.stringify({ action }) }).catch(() => {});
    await load();
    onChanged();
    setBusy(null);
  };
  const short = (f: string) => f.replace(/^\/Users\/[^/]+/, "~");
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold">Learning</h2>
        <label className="flex items-center gap-2 text-xs">
          <span className="text-muted">{s.learn ? "On" : "Off"}</span>
          <input type="checkbox" checked={s.learn} disabled={!s.folders.length} onChange={(e) => void save({ learn: e.target.checked })} aria-label="Learn from my Claude sessions" />
        </label>
      </div>
      <p className="text-[0.75rem] leading-relaxed text-muted">Learn from your Claude sessions while they run, in these folders only:</p>
      <div className="flex flex-wrap gap-1.5">
        {s.folders.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2 py-0.5 text-[0.7rem]" title={f}>
            {short(f)}
            <button onClick={() => void save({ folders: s.folders.filter((x) => x !== f), ...(s.folders.length === 1 ? { learn: false } : {}) })} aria-label={`Stop learning from ${short(f)}`} className="text-muted hover:text-red-600">
              <X size={11} />
            </button>
          </span>
        ))}
        <FolderChip
          value={adding}
          onChange={(f) => {
            setAdding("");
            if (f && !s.folders.includes(f)) void save({ folders: [...s.folders, f] });
          }}
          recent={recentFolders}
          down
        />
      </div>
      {!s.folders.length && <p className="text-[0.7rem] text-muted">Pick a folder first, then switch it on.</p>}
      <p className="text-[0.7rem] text-muted">Sessions count by the folder they started in, so a project you renamed may still be under its old folder.</p>
      <div className="space-y-0.5 text-[0.7rem] text-muted">
        <div>{d.status.running ? "Reading new turns now…" : `Last looked: ${when(d.status.lastRun)}`}</div>
        <div>
          Today: {d.status.runsToday} of {s.maxRunsPerDay} curator runs{d.status.skipped ? ` · ${d.status.skipped} batches skipped as noise` : ""}
        </div>
        <div>Last tidy-up: {when(d.status.lastReflection)}</div>
        {d.status.lastError && <div className="text-red-600">{d.status.lastError}</div>}
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void run("learn")} disabled={!!busy || !s.folders.length} className={btn} title="Read the new turns of your sessions now, without waiting">
          {busy === "learn" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Learn now
        </button>
        <button onClick={() => void run("reflect")} disabled={!!busy} className={btn} title="Merge duplicates and let unused minor memories fade, now">
          {busy === "reflect" ? <Loader2 size={12} className="animate-spin" /> : <History size={12} />} Tidy now
        </button>
      </div>
    </section>
  );
}

const OP_LABEL: Record<string, string> = { add: "Added", update: "Updated", forget: "Forgot", merge: "Merged", fade: "Faded", strengthen: "Strengthened" };

function Activity({ bots }: { bots: Bot[] }) {
  const { d } = useLearn();
  void bots;
  if (!d) return <Loader2 size={16} className="animate-spin text-muted" />;
  if (!d.activity.length) return <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Nothing yet. Turn on Learning and work in one of its folders, or press Learn now.</p>;
  return (
    <div className="space-y-2">
      {d.activity.map((a) => (
        <article key={a.id} className="rounded-xl border border-line bg-panel p-3">
          <div className="flex items-baseline gap-2 text-xs text-muted">
            <span className="font-medium text-ink">{a.kind === "learn" ? (a.session?.title ?? "A session") : "Tidy-up"}</span>
            <span className="flex-1 truncate">{a.kind === "learn" && a.session?.folder ? a.session.folder.replace(/^\/Users\/[^/]+/, "~") : ""}</span>
            <span>{when(a.at)}</span>
          </div>
          {a.ops.length ? (
            <ul className="mt-1.5 space-y-0.5">
              {a.ops.map((o, i) => (
                <li key={i} className="flex items-start gap-2 text-[0.8rem]">
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[0.65rem] ${o.op === "forget" || o.op === "fade" ? "bg-red-500/10 text-red-700 dark:text-red-400" : o.op === "add" ? "bg-green-500/15 text-green-700 dark:text-green-400" : "bg-accent-soft text-accent"}`}>
                    {OP_LABEL[o.op] ?? o.op}
                  </span>
                  <span className="min-w-0 flex-1">
                    {o.title}
                    {o.why && <span className="text-muted"> · {o.why}</span>}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[0.8rem] text-muted">{a.note ?? "No changes."}</p>
          )}
        </article>
      ))}
    </div>
  );
}
