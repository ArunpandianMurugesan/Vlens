"use client";

import { ArrowLeft, Bell, BookOpen, Check, Clock, FileCode, FolderOpen, Loader2, Lock, MoreHorizontal, Play, Plug, Plus, Shield, Terminal, Trash2, User, X, Zap } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { PERMISSION_MODES } from "@/lib/modes";
import { MODELS } from "@/lib/models";
import type { Bot, BotHook, BotTrigger } from "@/lib/types";

// A bot's Settings page: six sections, like the harness's agent.yaml (triggers,
// knowledge, powers, permissions) plus its profile and notifications. Everything
// here is yours to change; the bot can only suggest changes in its chat. "View
// as file" is the same thing as YAML.

type Save = (patch: Partial<Bot>) => Promise<void>;

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? r.statusText);
  return d as T;
}

const btn = "inline-flex items-center gap-1 rounded-lg border border-line bg-bg px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";
const box = "rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent";
const field = `w-full ${box}`;
const mono = "font-mono text-xs";
const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const short = (n: string) => n.replace(/^claude\.ai /, "");
const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40 ${on ? "bg-accent" : "bg-line"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

const Section = ({ id, icon, title, right, children }: { id: string; icon: ReactNode; title: string; right?: ReactNode; children: ReactNode }) => (
  <section id={id} className="scroll-mt-4 rounded-2xl border border-line bg-panel px-5 py-4">
    <div className="mb-2 flex items-center gap-2">
      <span className="text-muted">{icon}</span>
      <h2 className="text-[0.95rem] font-semibold">{title}</h2>
      <span className="flex-1" />
      {right}
    </div>
    {children}
  </section>
);

const Row = ({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) => (
  <div className="flex items-start gap-3 border-t border-line py-2.5 first:border-t-0 text-sm">
    <span className={`shrink-0 pt-1 text-xs text-muted ${wide ? "w-36" : "w-24"}`}>{label}</span>
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
  </div>
);

// A text you edit, then save (so each keystroke isn't a commit).
function Edit({ value, onSave, rows = 1, placeholder, code }: { value: string; onSave: (v: string) => Promise<void>; rows?: number; placeholder?: string; code?: boolean }) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(value), [value]);
  const dirty = v !== value;
  const save = async () => {
    setBusy(true);
    await onSave(v).finally(() => setBusy(false));
  };
  return (
    <div className="flex w-full items-start gap-2">
      {rows > 1 ? (
        <textarea value={v} rows={rows} placeholder={placeholder} onChange={(e) => setV(e.target.value)} className={`${field} resize-y ${code ? mono : ""}`} />
      ) : (
        <input value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && dirty && void save()} className={`${field} ${code ? mono : ""}`} />
      )}
      {dirty && (
        <div className="flex shrink-0 gap-1">
          <button onClick={() => void save()} disabled={busy} className={btn}>
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
          </button>
          <button onClick={() => setV(value)} className={btn} aria-label="Undo changes">
            <X size={11} />
          </button>
        </div>
      )}
    </div>
  );
}

const SECTIONS = [
  ["profile", "Profile"],
  ["triggers", "Triggers"],
  ["knowledge", "Knowledge"],
  ["powers", "Powers"],
  ["permissions", "Permissions"],
  ["notifications", "Notifications"],
] as const;

// embedded: shown inside Configuration's "Under the hood" (BotSetup.tsx), without its own back button.
export function BotSettings({ bot, save, onBack, onNotes, onDeleted, embedded }: { bot: Bot; save: Save; onBack: () => void; onNotes: () => void; onDeleted: () => void; embedded?: boolean }) {
  const [file, setFile] = useState(false);
  const [more, setMore] = useState(false);
  return (
    <div className={embedded ? "" : "min-h-0 flex-1 overflow-y-auto scroll-thin"}>
      <div className={embedded ? "space-y-4 p-4" : "mx-auto max-w-4xl space-y-4 px-6 py-6 pr-16 md:pr-6"}>
        {!embedded && (
          <button onClick={onBack} className="inline-flex items-center gap-1 rounded-lg bg-sunken px-2.5 py-1 text-xs hover:text-accent">
            <ArrowLeft size={13} /> Back to bot
          </button>
        )}
        <header className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-lg text-accent">{bot.avatar || bot.name[0]}</span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{bot.name} · settings</h1>
            <nav className="flex flex-wrap gap-x-1.5 text-xs text-muted" aria-label="Sections">
              {SECTIONS.map(([id, t], i) => (
                <span key={id} className="flex items-center gap-1.5">
                  {i > 0 && <span aria-hidden>·</span>}
                  <a href={`#${id}`} className="hover:text-accent">
                    {t}
                  </a>
                </span>
              ))}
            </nav>
          </div>
          <button onClick={() => setFile(true)} className={btn}>
            <FileCode size={12} /> View as file
          </button>
          <div className="relative">
            <button onClick={() => setMore((v) => !v)} className={btn} aria-label="More">
              <MoreHorizontal size={13} />
            </button>
            {more && (
              <div className="absolute right-0 top-8 z-30 w-44 rounded-xl border border-line bg-panel py-1 text-sm shadow-xl">
                <button onClick={() => void api("/api/file/open", { method: "POST", body: JSON.stringify({ path: bot.dir, how: "finder" }) }).finally(() => setMore(false))} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-sunken">
                  <FolderOpen size={13} /> Show in Finder
                </button>
                <button
                  onClick={() => {
                    setMore(false);
                    if (window.confirm(`Delete ${bot.name}? Its folder and notes move to Vlens's trash.`)) void api(`/api/bots/${bot.id}`, { method: "DELETE" }).then(onDeleted);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-red-600 hover:bg-sunken"
                >
                  <Trash2 size={13} /> Delete bot
                </button>
              </div>
            )}
          </div>
        </header>

        <Profile bot={bot} save={save} />
        <Triggers bot={bot} save={save} />
        <Knowledge bot={bot} save={save} onNotes={onNotes} />
        <Powers bot={bot} save={save} />
        <Permissions bot={bot} save={save} />
        <Notifications bot={bot} save={save} />
      </div>
      {file && <ConfigFile bot={bot} onClose={() => setFile(false)} />}
    </div>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────────

const EFFORTS = [
  ["", "Default"],
  ["low", "Low"],
  ["medium", "Medium"],
  ["high", "High"],
  ["xhigh", "Extra high"],
  ["max", "Max"],
] as const;

function Profile({ bot, save }: { bot: Bot; save: Save }) {
  return (
    <Section id="profile" icon={<User size={16} />} title="Profile">
      <Row label="Name">
        <div className="w-16">
          <Edit value={bot.avatar} onSave={(avatar) => save({ avatar: avatar.slice(0, 2) })} placeholder="B" />
        </div>
        <div className="min-w-0 flex-1">
          <Edit value={bot.name} onSave={(name) => save({ name })} />
        </div>
      </Row>
      <Row label="About">
        <Edit value={bot.about} onSave={(about) => save({ about })} placeholder="One line on its card, like: Reviews my PRs and drafts comments" />
      </Row>
      <Row label="Model">
        <select value={bot.model} onChange={(e) => void save({ model: e.target.value })} className={`${box}`} aria-label="Model">
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">Effort</span>
        <select value={bot.effort ?? ""} onChange={(e) => void save({ effort: e.target.value as Bot["effort"] })} className={`${box}`} aria-label="Effort">
          {EFFORTS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </Row>
      <Row label="Playbook">
        <div className="w-full space-y-1">
          <Edit value={bot.role} rows={8} onSave={(role) => save({ role })} placeholder="What it's for, and how it does its job, step by step." />
          <p className="text-[0.7rem] text-muted">How it does its job. Goes at the top of its CLAUDE.md, with its rules and notes index.</p>
        </div>
      </Row>
      <Row label="Writing style">
        <Edit value={bot.style} rows={3} onSave={(style) => save({ style })} />
      </Row>
    </Section>
  );
}

// ── Triggers ────────────────────────────────────────────────────────────────

type LastRun = { lastRun: string | null; lastResult: string | null; lastError: string | null };
const newTrigger = (kind: BotTrigger["kind"], n: number): BotTrigger => ({
  id: `${kind === "schedule" ? "check" : "session"}-${n}`,
  name: kind === "schedule" ? "New check" : "Session ended",
  on: false,
  kind,
  everyMinutes: 15,
  list: "",
  gate: "",
  event: "ended",
  idleMinutes: 30,
  folders: [],
  match: "",
  brief: kind === "schedule" ? "Work on {key}: {title}\n{url}" : "My Claude session {session} in {folder} just ended. Read it and update the {key} card.",
  updateBrief: kind === "schedule" ? "{key} changed (now {version}). Check what's new." : "",
  maxNew: 3,
});

function Triggers({ bot, save }: { bot: Bot; save: Save }) {
  const list = bot.triggers ?? [];
  const [runs, setRuns] = useState<Record<string, LastRun>>({});
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => api<{ triggers: Record<string, LastRun> }>(`/api/bots/${bot.id}/watch`).then((d) => setRuns(d.triggers)).catch(() => {}), [bot.id]);
  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);
  const put = (next: BotTrigger[]) => save({ triggers: next });
  const add = (kind: BotTrigger["kind"]) => {
    setAdding(false);
    let n = list.length + 1;
    while (list.some((t) => t.id === newTrigger(kind, n).id)) n++;
    void put([...list, newTrigger(kind, n)]);
  };
  return (
    <Section
      id="triggers"
      icon={<Zap size={16} />}
      title="Triggers"
      right={
        <div className="relative">
          <button onClick={() => setAdding((v) => !v)} className={btn}>
            <Plus size={12} /> Add trigger
          </button>
          {adding && (
            <div className="absolute right-0 top-8 z-30 w-64 rounded-xl border border-line bg-panel py-1 text-sm shadow-xl">
              <button onClick={() => add("schedule")} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-sunken">
                <Clock size={14} className="mt-0.5" />
                <span>
                  Schedule
                  <span className="block text-xs text-muted">Every few minutes, a command lists things to work on</span>
                </span>
              </button>
              <button onClick={() => add("session")} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-sunken">
                <Terminal size={14} className="mt-0.5" />
                <span>
                  Local session
                  <span className="block text-xs text-muted">One of your Claude sessions starts, ends or goes idle</span>
                </span>
              </button>
            </div>
          )}
        </div>
      }
    >
      {!list.length && <p className="py-2 text-sm text-muted">Nothing wakes it up yet: it only works when you message it. Add a trigger to let it work on its own. Finding work costs no tokens; only new or changed items start a card.</p>}
      <div className="space-y-2.5">
        {list.map((t, i) => (
          <TriggerCard
            key={t.id}
            bot={bot}
            t={t}
            last={runs[t.id] ?? null}
            onSave={(next) => put(list.map((x, j) => (j === i ? next : x)))}
            onDelete={() => window.confirm(`Delete the trigger "${t.name}"? Its cards stay.`) && void put(list.filter((_, j) => j !== i))}
            onRan={load}
          />
        ))}
      </div>
    </Section>
  );
}

const summary = (t: BotTrigger) => (t.kind === "schedule" ? `Schedule · every ${t.everyMinutes} min` : `Local session · ${t.event === "idle" ? `idle ${t.idleMinutes} min` : t.event}`);
const Placeholders = ({ kind }: { kind: BotTrigger["kind"] }) => (
  <span className="flex flex-wrap gap-1">
    {(kind === "schedule" ? ["key", "title", "url", "version"] : ["key", "title", "session", "folder"]).map((p) => (
      <code key={p} className="rounded bg-sunken px-1.5 py-0.5 text-[0.65rem] text-muted">{`{${p}}`}</code>
    ))}
  </span>
);

function TriggerCard({ bot, t, last, onSave, onDelete, onRan }: { bot: Bot; t: BotTrigger; last: LastRun | null; onSave: (t: BotTrigger) => Promise<void>; onDelete: () => void; onRan: () => void }) {
  const [d, setD] = useState(t);
  const [open, setOpen] = useState(!t.list && !t.folders.length);
  const [busy, setBusy] = useState<string | null>(null);
  const [test, setTest] = useState<{ kind: "list" | "gate" | "run"; ok: boolean; text: string } | null>(null);
  const [testItem, setTestItem] = useState("");
  useEffect(() => setD(t), [t]);
  const dirty = JSON.stringify(d) !== JSON.stringify(t);
  const set = (p: Partial<BotTrigger>) => setD((x) => ({ ...x, ...p }));
  const call = async (action: "list" | "gate" | "run") => {
    setBusy(action);
    setTest(null);
    try {
      if (dirty) await onSave(d); // test what you see
      const body = action === "gate" ? { trigger: t.id, action, item: { key: testItem || "TEST-1", title: "A test item" } } : { trigger: t.id, action };
      const r = await api<{ ok: boolean; summary?: string; result?: string; items?: { key: string; title: string }[]; error?: string }>(`/api/bots/${bot.id}/watch`, { method: "POST", body: JSON.stringify(body) });
      if (action === "list") setTest({ kind: action, ok: r.ok, text: r.error ?? (r.items?.length ? r.items.map((i) => `${i.key} · ${i.title}`).join("\n") : "Found nothing right now.") });
      else setTest({ kind: action, ok: r.ok, text: (action === "gate" ? r.result : r.summary) ?? "" });
      if (action === "list" && r.items?.[0] && !testItem) setTestItem(r.items[0].key);
      if (action === "run") onRan();
    } catch (e) {
      setTest({ kind: action, ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const ready = t.kind === "schedule" ? !!t.list.trim() : t.folders.length > 0;
  return (
    <div className={`rounded-xl border px-3.5 py-2.5 ${t.on ? "border-accent/50" : "border-line"} bg-bg`}>
      <div className="flex items-center gap-2 text-sm">
        {t.kind === "schedule" ? <Clock size={14} className="text-muted" /> : <Terminal size={14} className="text-muted" />}
        <strong className="font-semibold">{t.name}</strong>
        <span className="rounded-md bg-sunken px-2 py-0.5 text-[0.7rem] text-muted">{summary(t)}</span>
        <span className="flex-1" />
        <button onClick={() => setOpen((v) => !v)} className="text-xs text-muted hover:text-accent">
          {open ? "Done" : "Edit"}
        </button>
        <Switch on={t.on} disabled={!ready && !t.on} label={`${t.name} on`} onChange={(on) => void onSave({ ...t, on })} />
      </div>

      {!open ? (
        <div className="mt-1.5 space-y-1 text-xs text-muted">
          {t.kind === "schedule" ? (
            <div className="truncate">
              List <code className="text-ink">{t.list.split("\n")[0] || "not set"}</code>
              {t.gate && (
                <>
                  {" "}
                  · gate <code className="text-ink">{t.gate.split("\n")[0]}</code>
                </>
              )}
            </div>
          ) : (
            <div className="truncate">
              {t.folders.map(home).join(", ") || "No folders yet"}
              {t.match && (
                <>
                  {" "}
                  · match <code className="text-ink">{t.match}</code>
                </>
              )}
            </div>
          )}
          <div className="truncate">Brief: {t.brief.split("\n")[0] || "none"}</div>
        </div>
      ) : (
        <div className="mt-2 space-y-0">
          <Row label="Name">
            <input value={d.name} onChange={(e) => set({ name: e.target.value })} className={field} />
          </Row>
          {d.kind === "schedule" ? (
            <>
              <Row label="Every">
                <input type="number" min={5} value={d.everyMinutes} onChange={(e) => set({ everyMinutes: Number(e.target.value) || 15 })} className={`${box} w-20`} aria-label="Minutes between checks" />
                <span className="text-xs text-muted">minutes (5 or more)</span>
              </Row>
              <Row label="List">
                <div className="w-full space-y-1">
                  <textarea value={d.list} rows={3} onChange={(e) => set({ list: e.target.value })} placeholder="gh search prs --review-requested=@me --state=open --json number,title,url,repository --jq '.[] | {key: ...}'" className={`${field} ${mono}`} />
                  <p className="text-[0.7rem] text-muted">A command (no AI) that prints the items, as JSON: {"{key, title, url, version}"}. Runs in the bot&apos;s folder.</p>
                </div>
                <button onClick={() => void call("list")} disabled={!!busy || !d.list.trim()} className={btn}>
                  {busy === "list" ? <Loader2 size={11} className="animate-spin" /> : null} Test
                </button>
              </Row>
            </>
          ) : (
            <>
              <Row label="When">
                <select value={d.event} onChange={(e) => set({ event: e.target.value as BotTrigger["event"] })} className={`${box}`} aria-label="Session event">
                  <option value="ended">A session ends</option>
                  <option value="started">A session starts</option>
                  <option value="idle">A session goes idle</option>
                </select>
                {d.event === "idle" && (
                  <>
                    <input type="number" min={5} value={d.idleMinutes} onChange={(e) => set({ idleMinutes: Number(e.target.value) || 30 })} className={`${box} w-20`} aria-label="Idle minutes" />
                    <span className="text-xs text-muted">minutes</span>
                  </>
                )}
              </Row>
              <Row label="Folders">
                <FolderPicker value={d.folders} onChange={(folders) => set({ folders })} />
              </Row>
              <Row label="Match">
                <div className="w-full space-y-1">
                  <input value={d.match} onChange={(e) => set({ match: e.target.value })} placeholder="[A-Z]+-\d+" className={`${field} ${mono}`} />
                  <p className="text-[0.7rem] text-muted">Optional. A pattern looked for in the session&apos;s title and recent text; its first match (like a Jira key) is the card. Empty: one card per session.</p>
                </div>
                <button onClick={() => void call("list")} disabled={!!busy || !d.folders.length} className={btn}>
                  {busy === "list" ? <Loader2 size={11} className="animate-spin" /> : null} Test
                </button>
              </Row>
              {!bot.sessionAccess?.all && !d.folders.every((f) => bot.sessionAccess?.folders.includes(f)) && (
                <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-400">To read these sessions, the bot also needs them under Knowledge, Claude sessions.</p>
              )}
            </>
          )}
          <Row label="Gate">
            <div className="w-full space-y-1">
              <textarea value={d.gate} rows={2} onChange={(e) => set({ gate: e.target.value })} placeholder="Optional. Runs per item with $VLENS_KEY, $VLENS_URL…" className={`${field} ${mono}`} />
              <p className="text-[0.7rem] text-muted">Exit 10 skips the item, 75 tries again next check, 0 goes on and adds what it printed to the brief.</p>
            </div>
            <input value={testItem} onChange={(e) => setTestItem(e.target.value)} placeholder="Item key" className={`${box} w-28`} aria-label="Item key to test the gate on" />
            <button onClick={() => void call("gate")} disabled={!!busy || !d.gate.trim()} className={btn}>
              {busy === "gate" ? <Loader2 size={11} className="animate-spin" /> : null} Test on item
            </button>
          </Row>
          <Row label="Brief">
            <div className="w-full space-y-1">
              <textarea value={d.brief} rows={3} onChange={(e) => set({ brief: e.target.value })} className={field} />
              <Placeholders kind={d.kind} />
            </div>
          </Row>
          <Row label="On change">
            <div className="w-full space-y-1">
              <textarea value={d.updateBrief} rows={2} onChange={(e) => set({ updateBrief: e.target.value })} placeholder={d.kind === "schedule" ? "Sent to its card when the item's version changes (a new push…). Empty: nothing." : "Sent when its card already exists. Empty: the brief again."} className={field} />
            </div>
          </Row>
          <Row label="Max new">
            <input type="number" min={1} value={d.maxNew} onChange={(e) => set({ maxNew: Number(e.target.value) || 3 })} className={`${box} w-20`} aria-label="Max new cards per check" />
            <span className="text-xs text-muted">cards per check; the rest wait for the next one</span>
          </Row>
          <div className="flex items-center gap-2 pt-2">
            <button onClick={() => void onSave(d)} disabled={!dirty} className={`${btn} ${dirty ? "border-accent text-accent" : ""}`}>
              <Check size={11} /> Save trigger
            </button>
            {dirty && (
              <button onClick={() => setD(t)} className={btn}>
                Undo
              </button>
            )}
            <span className="flex-1" />
            <button onClick={onDelete} className="inline-flex items-center gap-1 text-xs text-muted hover:text-red-600">
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>
      )}

      {test && <pre className={`mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs scroll-thin ${test.ok ? "bg-sunken/70" : "bg-red-500/10 text-red-600"}`}>{test.text}</pre>}

      <div className="mt-2 flex items-center gap-2 border-t border-line pt-2 text-xs">
        {last?.lastRun ? (
          <span className={`rounded-md px-2 py-0.5 ${last.lastError ? "bg-red-500/10 text-red-600" : "bg-green-500/10 text-green-700 dark:text-green-400"}`}>Last run {ago(last.lastRun)}</span>
        ) : (
          <span className="text-muted">Not run yet</span>
        )}
        <span className="min-w-0 flex-1 truncate text-muted" title={last?.lastError ?? last?.lastResult ?? ""}>
          {last?.lastError ?? last?.lastResult ?? ""}
        </span>
        <button onClick={() => void call("run")} disabled={!!busy || !ready} className={btn}>
          {busy === "run" ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />} Run now
        </button>
      </div>
    </div>
  );
}

// Folders your Claude sessions ran in, to pick from.
function useSessionFolders() {
  const [folders, setFolders] = useState<{ path: string; sessions: number }[]>([]);
  useEffect(() => {
    api<{ folders: { path: string; sessions: number }[] }>("/api/bots/session-folders")
      .then((d) => setFolders(d.folders))
      .catch(() => {});
  }, []);
  return folders;
}

function FolderPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const folders = useSessionFolders();
  const [q, setQ] = useState("");
  const shown = folders.filter((f) => !q || f.path.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  return (
    <div className="w-full space-y-1.5">
      <div className="flex flex-wrap gap-1">
        {value.map((f) => (
          <span key={f} className="inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[0.7rem] text-accent">
            {home(f)}
            <button onClick={() => onChange(value.filter((x) => x !== f))} aria-label={`Remove ${f}`}>
              <X size={10} />
            </button>
          </span>
        ))}
        {!value.length && <span className="text-xs text-muted">None picked</span>}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter folders, or type a path and press Enter" onKeyDown={(e) => e.key === "Enter" && q.startsWith("/") && (onChange([...new Set([...value, q.replace(/\/+$/, "")])]), setQ(""))} className={`${field} text-xs`} />
      <div className="max-h-36 overflow-y-auto rounded-lg border border-line p-1 scroll-thin">
        {shown.map((f) => (
          <label key={f.path} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-0.5 hover:bg-sunken/60">
            <input type="checkbox" checked={value.includes(f.path)} onChange={(e) => onChange(e.target.checked ? [...value, f.path] : value.filter((x) => x !== f.path))} className="accent-[var(--color-accent)]" />
            <span className="min-w-0 flex-1 truncate font-mono text-[0.7rem]" title={f.path}>
              {home(f.path)}
            </span>
            <span className="text-[0.65rem] text-muted">{f.sessions}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ── Knowledge ───────────────────────────────────────────────────────────────

function Knowledge({ bot, save, onNotes }: { bot: Bot; save: Save; onNotes: () => void }) {
  const [counts, setCounts] = useState<string>("");
  const [page, setPage] = useState("");
  const pages = bot.knowledge?.confluence ?? [];
  useEffect(() => {
    api<{ concepts: { path: string }[] }>(`/api/bots/${bot.id}/knowledge`)
      .then(({ concepts }) => {
        const by = (p: string) => concepts.filter((c) => c.path.startsWith(`${p}/`)).length;
        const rules = by("rules");
        const issues = by("issues");
        const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
        setCounts(`${n(concepts.length - rules - issues, "note")} · ${n(rules, "rule")} · ${n(issues, "issue")}`);
      })
      .catch(() => {});
  }, [bot.id, bot.notes]);
  const addPage = () => {
    const id = /pages\/(\d+)/.exec(page)?.[1] ?? (/^\d+$/.test(page.trim()) ? page.trim() : "");
    if (!id) return;
    const title = /pages\/\d+\/([^/?#]+)/.exec(page)?.[1]?.replace(/\+/g, " ") ?? "";
    setPage("");
    void save({ knowledge: { confluence: [...pages.filter((p) => p.id !== id), { id, title: decodeURIComponent(title) }] } });
  };
  return (
    <Section id="knowledge" icon={<BookOpen size={16} />} title="Knowledge">
      <Row label="Notes">
        <span className="text-xs text-muted">{counts || "…"}</span>
        <span className="flex-1" />
        <button onClick={onNotes} className={btn}>
          Browse
        </button>
      </Row>
      <Row label="Confluence">
        <div className="w-full space-y-1.5">
          {pages.map((p) => (
            <div key={p.id} className="flex items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{p.title || `Page ${p.id}`}</span>
              <span className="font-mono text-[0.7rem] text-muted">{p.id}</span>
              <button onClick={() => void save({ knowledge: { confluence: pages.filter((x) => x.id !== p.id) } })} className="text-muted hover:text-red-600" aria-label={`Remove page ${p.id}`}>
                <X size={12} />
              </button>
            </div>
          ))}
          <div className="flex gap-2">
            <input value={page} onChange={(e) => setPage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addPage()} placeholder="Paste a Confluence page link" className={`${field} text-xs`} />
            <button onClick={addPage} disabled={!page.trim()} className={btn}>
              <Plus size={11} /> Page
            </button>
          </div>
          <p className="text-[0.7rem] text-muted">Read fresh at the start of each chat, with its Confluence connector (turn one on under Powers).</p>
        </div>
      </Row>
      <Row label="My CLAUDE.md">
        <span className="text-xs text-muted">Always included, like in your Claude Code (~/.claude/CLAUDE.md), under its own playbook.</span>
      </Row>
      <Row label="Claude sessions">
        <SessionAccess bot={bot} save={save} />
      </Row>
    </Section>
  );
}

function SessionAccess({ bot, save }: { bot: Bot; save: Save }) {
  const a = bot.sessionAccess ?? { all: false, folders: [] };
  const [some, setSome] = useState(!a.all && a.folders.length > 0);
  const choice = a.all ? "all" : some || a.folders.length ? "some" : "off";
  const set = (all: boolean, folders: string[]) => void save({ sessionAccess: { all, folders } });
  return (
    <div className="w-full space-y-1.5">
      <select
        value={choice}
        onChange={(e) => {
          const v = e.target.value;
          setSome(v === "some");
          if (v === "off") set(false, []);
          else set(v === "all", a.folders);
        }}
        className={`${box}`}
        aria-label="Claude sessions it may read"
      >
        <option value="off">Off</option>
        <option value="some">Only folders I pick</option>
        <option value="all">All folders</option>
      </select>
      {choice === "some" && <FolderPicker value={a.folders} onChange={(f) => set(false, f)} />}
      <p className="text-[0.7rem] text-muted">Sessions from the terminal, desktop app and Vlens, running or ended, plus each project&apos;s memory files. Read-only.</p>
    </div>
  );
}

// ── Powers ──────────────────────────────────────────────────────────────────

interface PowerList {
  connectors: { name: string; status: string }[];
  skills: { name: string; description: string; source: string }[];
  plugins: { id: string; name: string; description: string; enabled: boolean }[];
  hookEvents: string[];
}

const Chip = ({ on, onClick, children, title, dot }: { on: boolean; onClick: () => void; children: ReactNode; title?: string; dot?: string }) => (
  <button onClick={onClick} title={title} aria-pressed={on} className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs transition ${on ? "bg-green-500/15 text-green-800 dark:text-green-300" : "bg-sunken text-muted hover:text-ink"}`}>
    {dot && <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />}
    {children}
  </button>
);

function Powers({ bot, save }: { bot: Bot; save: Save }) {
  const [p, setP] = useState<PowerList | null>(null);
  useEffect(() => {
    api<PowerList>(`/api/bots/${bot.id}/powers`).then(setP).catch(() => {});
  }, [bot.id]);
  const skillsAll = !Array.isArray(bot.skills);
  const toggle = (xs: string[], x: string) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);
  const status = (s: string) => (s === "connected" ? "bg-green-500" : s === "needs-auth" ? "bg-amber-500" : "bg-red-500");
  return (
    <Section id="powers" icon={<Plug size={16} />} title="Powers">
      {!p && (
        <p className="flex items-center gap-2 py-1 text-xs text-muted">
          <Loader2 size={13} className="animate-spin" /> Asking Claude Code for your connectors, skills and plugins (takes a few seconds)…
        </p>
      )}
      {p && (
        <>
          <Row label="Connectors">
            {p.connectors.map((c) => (
              <Chip key={c.name} on={bot.mcp.includes(c.name)} dot={status(c.status)} title={c.status} onClick={() => void save({ mcp: toggle(bot.mcp, c.name) })}>
                {short(c.name)}
              </Chip>
            ))}
            {!p.connectors.length && <span className="text-xs text-muted">You have no connectors yet.</span>}
          </Row>
          <Row label="Skills">
            <div className="w-full space-y-2">
              <label className="flex items-center gap-2 text-xs">
                <Switch on={skillsAll} label="All my skills" onChange={(v) => void save({ skills: v ? null : [] })} />
                All my skills
              </label>
              {!skillsAll && (
                <div className="flex flex-wrap gap-1.5">
                  {p.skills.map((s) => (
                    <Chip key={s.name} on={bot.skills!.includes(s.name)} title={s.description} onClick={() => void save({ skills: toggle(bot.skills!, s.name) })}>
                      {s.name}
                    </Chip>
                  ))}
                </div>
              )}
              <p className="text-[0.7rem] text-muted">Its own skills live in its folder, in .claude/skills.</p>
            </div>
          </Row>
          <Row label="Plugins">
            {p.plugins.map((pl) => {
              const on = bot.plugins?.[pl.id] ?? pl.enabled;
              return (
                <Chip key={pl.id} on={on} title={pl.description} onClick={() => void save({ plugins: { ...(bot.plugins ?? {}), [pl.id]: !on } })}>
                  {pl.name}
                </Chip>
              );
            })}
            {!p.plugins.length && <span className="text-xs text-muted">No plugins installed.</span>}
          </Row>
          <Row label="Hooks">
            <Hooks bot={bot} events={p.hookEvents} save={save} />
          </Row>
        </>
      )}
    </Section>
  );
}

function Hooks({ bot, events, save }: { bot: Bot; events: string[]; save: Save }) {
  const hooks = bot.hooks ?? [];
  const [draft, setDraft] = useState<BotHook | null>(null);
  const put = (next: BotHook[]) => save({ hooks: next });
  return (
    <div className="w-full space-y-1.5">
      {hooks.map((h, i) => (
        <div key={h.id} className="flex items-center gap-2 text-xs">
          <code className="rounded bg-sunken px-1.5 py-0.5">
            {h.event}
            {h.matcher ? ` · ${h.matcher}` : ""}
          </code>
          <span className="text-muted">→</span>
          <code className="min-w-0 flex-1 truncate" title={h.command}>
            {h.command}
          </code>
          <Switch on={h.on} label={`Hook ${h.event} on`} onChange={(on) => void put(hooks.map((x, j) => (j === i ? { ...x, on } : x)))} />
          <button onClick={() => window.confirm("Delete this hook?") && void put(hooks.filter((_, j) => j !== i))} className="text-muted hover:text-red-600" aria-label="Delete hook">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {draft ? (
        <div className="space-y-1.5 rounded-lg border border-line p-2">
          <div className="flex gap-2">
            <select value={draft.event} onChange={(e) => setDraft({ ...draft, event: e.target.value })} className={`${box} text-xs`} aria-label="Hook event">
              {events.map((e) => (
                <option key={e}>{e}</option>
              ))}
            </select>
            <input value={draft.matcher} onChange={(e) => setDraft({ ...draft, matcher: e.target.value })} placeholder="Tool, like Bash (optional)" className={`${field} ${mono}`} />
          </div>
          <input value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} placeholder="Command, like ./hooks/check-draft.sh" className={`${field} ${mono}`} />
          <p className="text-[0.7rem] text-muted">Claude Code runs it at that event, with the tool call as JSON on stdin. Exit 2 blocks the call. It runs in the bot&apos;s folder.</p>
          <div className="flex gap-2">
            <button
              disabled={!draft.command.trim()}
              onClick={() => {
                void put([...hooks, { ...draft, id: `h${Date.now().toString(36)}` }]);
                setDraft(null);
              }}
              className={btn}
            >
              <Check size={11} /> Add hook
            </button>
            <button onClick={() => setDraft(null)} className={btn}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={() => setDraft({ id: "", on: true, event: "PreToolUse", matcher: "Bash", command: "" })} className={btn}>
            <Plus size={11} /> Hook
          </button>
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-0.5 text-[0.7rem] text-amber-700 dark:text-amber-400">
            <Lock size={10} /> only you can add these
          </span>
        </div>
      )}
    </div>
  );
}

// ── Permissions ─────────────────────────────────────────────────────────────

const lines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);

function Permissions({ bot, save }: { bot: Bot; save: Save }) {
  const never = bot.rules?.dontLookAt ?? [];
  return (
    <Section id="permissions" icon={<Shield size={16} />} title="Permissions">
      <Row label="Base" wide>
        <select value={bot.mode} onChange={(e) => void save({ mode: e.target.value })} className={`${box}`} aria-label="Permission mode">
          <option value="">Same as my Claude Code</option>
          {PERMISSION_MODES.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">{bot.mode ? "" : "Your default mode and allow rules apply."}</span>
      </Row>
      <Row label={`Runs without asking · ${bot.allowTools?.length ?? 0}`} wide>
        <div className="w-full space-y-1">
          <Edit value={(bot.allowTools ?? []).join("\n")} rows={4} code onSave={(v) => save({ allowTools: lines(v) })} placeholder="Bash(gh pr diff:*)" />
          <p className="text-[0.7rem] text-muted">Claude Code allow rules, one per line.</p>
        </div>
      </Row>
      <Row label={`Always asks · ${bot.askTools?.length ?? 0}`} wide>
        <div className="w-full space-y-1">
          <Edit value={(bot.askTools ?? []).join("\n")} rows={4} code onSave={(v) => save({ askTools: lines(v) })} placeholder="Bash(gh pr comment:*)" />
          <p className="text-[0.7rem] text-muted">Asks you every time, in any mode, like posting or pushing.</p>
        </div>
      </Row>
      <Row label={`Never · ${never.length + 2}`} wide>
        <div className="w-full space-y-1 text-xs">
          {never.map((x) => (
            <div key={x} className="font-mono">
              {x}
            </div>
          ))}
          <div className="font-mono text-muted">~/.claude/projects/** · ~/.claude/sessions/** (always: sessions only through Knowledge)</div>
          <p className="text-[0.7rem] text-muted">Its &ldquo;Don&apos;t look at&rdquo; rules. Ask the bot in its chat to change them.</p>
        </div>
      </Row>
      <Row label="Auto-save notes" wide>
        <Switch on={!!bot.autoSaveIssues} label="Auto-save notes" onChange={(v) => void save({ autoSaveIssues: v })} />
        <span className="text-xs text-muted">Saves its issue notes (drafts, status) without asking. Posting anywhere still asks.</span>
      </Row>
    </Section>
  );
}

// ── Notifications ───────────────────────────────────────────────────────────

function Notifications({ bot, save }: { bot: Bot; save: Save }) {
  const n = bot.notify ?? { digestDone: true, digestFailed: true };
  const set = (k: "needsYou" | "finished" | "failed" | "mac", v: boolean) => void save({ notify: { ...n, [k]: v } });
  const rows: ["needsYou" | "finished" | "failed" | "mac", string, boolean][] = [
    ["needsYou", "A card needs me", n.needsYou !== false],
    ["finished", "A card a trigger started finished", n.finished !== false],
    ["failed", "A trigger or card failed", n.failed !== false],
    ["mac", "Also as a Mac notification", !!n.mac],
  ];
  return (
    <Section id="notifications" icon={<Bell size={16} />} title="Notifications">
      {rows.map(([k, label, on]) => (
        <div key={k} className="flex items-center gap-3 border-t border-line py-2.5 text-sm first:border-t-0">
          <span className="flex-1">{label}</span>
          <Switch on={on} label={label} onChange={(v) => set(k, v)} />
        </div>
      ))}
    </Section>
  );
}

// ── View as file ────────────────────────────────────────────────────────────

function ConfigFile({ bot, onClose }: { bot: Bot; onClose: () => void }) {
  const [text, setText] = useState<string | null>(null);
  const [orig, setOrig] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ yaml: string }>(`/api/bots/${bot.id}/config`)
      .then((d) => {
        setText(d.yaml);
        setOrig(d.yaml);
      })
      .catch((e) => setErr((e as Error).message));
  }, [bot.id]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  const saveFile = async () => {
    setBusy(true);
    setErr(null);
    try {
      const d = await api<{ yaml: string }>(`/api/bots/${bot.id}/config`, { method: "PUT", body: JSON.stringify({ yaml: text }) });
      setText(d.yaml);
      setOrig(d.yaml);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div className="flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-line bg-panel shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <FileCode size={14} />
          <span className="text-sm font-medium">{bot.name} · configuration</span>
          <span className="text-xs text-muted">YAML</span>
          <button onClick={onClose} className="ml-auto text-muted hover:text-ink" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        {text === null ? (
          <Loader2 size={16} className="m-6 animate-spin text-muted" />
        ) : (
          <textarea value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} className="min-h-0 flex-1 resize-none bg-bg p-4 font-mono text-xs outline-none" aria-label="Configuration as YAML" />
        )}
        <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
          {err && <span className="min-w-0 flex-1 truncate text-xs text-red-600">{err}</span>}
          <span className="flex-1" />
          <button onClick={() => setText(orig)} disabled={text === orig} className={btn}>
            Undo
          </button>
          <button onClick={() => void saveFile()} disabled={busy || text === orig} className={`${btn} ${text !== orig ? "border-accent text-accent" : ""}`}>
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Save
          </button>
        </div>
      </div>
    </div>
  );
}
