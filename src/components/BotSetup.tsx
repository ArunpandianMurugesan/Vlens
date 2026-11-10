"use client";

import { AlertTriangle, ArrowLeft, Cloud, Loader2, MessageSquare, Pause, Play, Plug } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type BotFiles, readBotFiles } from "@/lib/botFile";
import type { Bot } from "@/lib/types";
import { AgentView, type FileCheck, FilesEditor, PlaybookView, Review } from "./BotFileView";
import { TriggerBoard } from "./BotTriggerBoard";

// A bot's Configuration, in plain words (design: "Bots, from scratch" → BotSetup):
// health, its job in its own words, its setup file (bot.md) shown as a page and
// changed with AI or by hand (checked, then applied with your OK), the apps it uses,
// when it tells you, and its limits. Changing things by chat works too: the bot
// shows each change and waits for your OK.

export type Health = { ok: boolean; trigger: string | null; error: string | null; since: string | null; failures: number; lastOk: string | null };
type Stats = { cards: number; waiting: number; ready: number; every: number | null; health?: Health; nextCheck?: string | null };
type Save = (patch: Partial<Bot>) => Promise<void>;

const btn = "inline-flex items-center gap-1 rounded-lg border border-line bg-bg px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";
const primary = "inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50";

export const day = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days < 1 ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : days < 7 ? d.toLocaleDateString([], { weekday: "short" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

// What its failing check means, in plain words.
export function healthTitle(h: Health) {
  const e = h.error ?? "";
  const what = /github|gh: /i.test(e) ? "Can't reach GitHub" : /could not resolve|network|timed out|ENOTFOUND|ECONN/i.test(e) ? "Can't reach the network" : `Its "${h.trigger}" check is failing`;
  return `${what}${h.since ? ` since ${day(h.since)}` : ""}`;
}

export const fixPrompt = (h: Health) =>
  `Your "${h.trigger}" trigger keeps failing (${h.failures} checks). The error is:\n\n${h.error}\n\nFind out why and tell me how to fix it. Ask me before changing anything.`;

export function HealthBanner({ health, onFix, className = "mx-4 mt-3" }: { health: Health; onFix: (text: string) => void; className?: string }) {
  const [details, setDetails] = useState(false);
  return (
    <div role="status" className={`${className} rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-red-800 dark:text-red-300`}>
      <div className="flex items-center gap-3">
        <AlertTriangle size={17} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{healthTitle(health)}</div>
          <div className="text-xs">
            {health.failures} check{health.failures === 1 ? "" : "s"} failed{health.lastOk ? ` · last good run ${day(health.lastOk)}` : ""}. It may be missing new work.
          </div>
        </div>
        <button onClick={() => onFix(fixPrompt(health))} className={primary}>
          Ask it to fix this
        </button>
        <button onClick={() => setDetails((v) => !v)} className="rounded-lg px-2 py-1 text-xs hover:bg-red-500/10">
          {details ? "Hide" : "Details"}
        </button>
      </div>
      {details && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-bg/60 p-2 font-mono text-[0.7rem] scroll-thin">{health.error}</pre>}
    </div>
  );
}

// Its job in plain words: what it wrote with set_job, or read from its setup until it does.
export function jobOf(bot: Bot): { when: string; think: string; act: string; own: boolean } {
  if (bot.job) return { ...bot.job, own: true };
  const ts = (bot.triggers ?? []).filter((t) => t.on);
  const when = ts.length
    ? ts.map((t) => (t.kind === "schedule" ? `Every ${t.everyMinutes} min I run my "${t.name}" check.` : `When one of your sessions ${t.event === "idle" ? `goes quiet for ${t.idleMinutes} min` : t.event}.`)).join(" ")
    : "When you message me.";
  // Its sentences, each ending with a full stop.
  const sentences = (xs: string[]) => xs.map((x) => (/[.!?]$/.test(x.trim()) ? x.trim() : `${x.trim()}.`)).join(" ");
  const think = sentences(bot.rules.lookAt.slice(0, 2)) || "What you tell me in chat, and my notes.";
  const act = sentences(bot.rules.allowed.slice(0, 2)) || "I draft things and ask you before posting anything.";
  return { when, think, act, own: false };
}
export const DESCRIBE_JOB = "Describe your job in your own words: call set_job with when, think and act.";

const until = (iso: string | null | undefined) => {
  if (!iso) return null;
  const m = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  return m <= 0 ? "any moment" : m < 60 ? `in ${m} min` : `in ${Math.round(m / 60)} h`;
};

function Card({ title, hint, children, action }: { title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="flex-1 text-sm font-semibold">{title}</h2>
        {hint && <span className="text-[0.7rem] text-muted">{hint}</span>}
        {action}
      </div>
      {children}
    </section>
  );
}

export function BotSetup(p: { bot: Bot & { stats?: Stats }; save: Save; onBack: () => void; onAsk: (text: string) => void; onNotes: () => void; onDeleted: () => void; onChanged: () => void; onAdvanced: () => void }) {
  const { bot, save } = p;
  const s = bot.stats;
  const h = s?.health;
  const hasTriggers = (bot.triggers ?? []).some((t) => t.on);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-7xl space-y-4 px-6 py-6 pr-16 md:pr-6 lg:px-8">
        <div className="flex items-center gap-3">
          <button onClick={p.onBack} className="inline-flex items-center gap-1 rounded-lg bg-sunken px-2.5 py-1 text-xs hover:text-accent">
            <ArrowLeft size={13} /> Back to chat
          </button>
        </div>
        <header className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-lg text-accent">{bot.avatar || bot.name[0]}</span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-xl font-semibold">{bot.name}</h1>
            <p className="truncate text-xs text-muted">{bot.about || "No description yet"} · on this Mac</p>
          </div>
          {hasTriggers && (
            <button onClick={() => void save({ paused: !bot.paused })} className={btn}>
              {bot.paused ? <Play size={12} /> : <Pause size={12} />} {bot.paused ? "Resume" : "Pause"}
            </button>
          )}
        </header>

        <div className="flex items-center gap-3 rounded-xl bg-accent-soft/50 px-4 py-2.5 text-sm">
          <MessageSquare size={16} className="shrink-0 text-accent" />
          <span className="flex-1">The easiest way to change anything here is to tell the bot in chat. It shows you the change and waits for your OK.</span>
          <button onClick={p.onBack} className={btn}>
            Open chat
          </button>
        </div>

        {h && !h.ok && <HealthBanner health={h} onFix={p.onAsk} className="" />}

        {/* Wide window: its setup file is the page, the rest sits beside it. */}
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <SetupFile bot={bot} onChanged={p.onChanged} />
          <aside className="space-y-4 lg:sticky lg:top-0">
            <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
              <Stat label="Last good run" value={h?.lastOk ? day(h.lastOk) : hasTriggers ? "Not yet" : "—"} />
              <Stat label="Open cards" value={`${s?.cards ?? 0}${s?.waiting || s?.ready ? ` · ${(s?.waiting ?? 0) + (s?.ready ?? 0)} need you` : ""}`} />
              <Stat label="Next check" value={!hasTriggers ? "Only when you message it" : bot.paused ? "Paused" : (until(s?.nextCheck) ?? "Soon")} />
            </div>
            <Apps bot={bot} />
            <TellMe bot={bot} save={save} />
            <Card title="Good to know">
              <p className="text-[0.8rem] leading-relaxed text-muted">
                It runs only while Vlens is open and your Mac is awake. It checks every {s?.every ? `${s.every}` : "1–15"} minutes, not instantly. It lives on this Mac only.
              </p>
              <button disabled className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-dashed border-line px-2.5 py-1 text-[0.7rem] text-muted">
                <Cloud size={12} /> Run 24/7 in the cloud · coming later
              </button>
            </Card>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pb-4 text-xs text-muted">
              <button onClick={p.onAdvanced} className="hover:text-ink">
                Advanced settings
              </button>
              <span aria-hidden>·</span>
              <button onClick={p.onNotes} className="hover:text-ink">
                Its notes
              </button>
              <span aria-hidden>·</span>
              <button
                onClick={() => window.confirm(`Delete ${bot.name}? Its folder and notes move to Vlens's trash.`) && void fetch(`/api/bots/${bot.id}`, { method: "DELETE" }).then(p.onDeleted)}
                className="text-red-600 hover:underline"
              >
                Delete bot
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl border border-line bg-panel px-3 py-2.5">
    <div className="text-[0.7rem] text-muted">{label}</div>
    <div className="truncate text-sm font-semibold">{value}</div>
  </div>
);

// ── Apps it uses ─────────────────────────────────────────────────────────────

type Conn = { name: string; status: string };
const appName = (n: string) => n.replace(/^claude\.ai /, "");

function Apps({ bot }: { bot: Bot }) {
  const [conns, setConns] = useState<Conn[] | null>(null);
  useEffect(() => {
    fetch(`/api/bots/${bot.id}/powers`)
      .then((r) => r.json())
      .then((d) => setConns(d.connectors ?? []))
      .catch(() => setConns([]));
  }, [bot.id]);
  const signIn = (name: string) => {
    if (name.startsWith("claude.ai ")) window.open("https://claude.ai/settings/connectors", "_blank");
    else void fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "login", name }) });
  };
  return (
    <Card title="Apps it uses" hint="Connectors it may use">
      {!conns ? (
        <Loader2 size={14} className="animate-spin text-muted" />
      ) : !bot.mcp.length ? (
        <p className="text-[0.8rem] text-muted">None yet. Tell it in chat which apps it needs, like Jira or Slack.</p>
      ) : (
        <div className="grid gap-2">
          {bot.mcp.map((n) => {
            const st = conns.find((c) => c.name === n)?.status ?? "unknown";
            const ok = st === "connected";
            const needs = st === "needs-auth";
            return (
              <div key={n} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${ok ? "border-line" : needs ? "border-amber-500/40" : "border-red-500/40"}`}>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sunken text-[0.7rem] font-bold">{appName(n).slice(0, 2).toUpperCase()}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{appName(n)}</div>
                  <div className={`text-[0.7rem] ${ok ? "text-green-700 dark:text-green-400" : needs ? "text-amber-700 dark:text-amber-400" : "text-red-700 dark:text-red-400"}`}>
                    {ok ? "Connected" : needs ? "Needs sign-in" : st === "unknown" ? "Status unknown" : "Can't connect"}
                  </div>
                </div>
                {!ok && (
                  <button onClick={() => signIn(n)} className={btn}>
                    Sign in
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ── Tell me when ─────────────────────────────────────────────────────────────

function TellMe({ bot, save }: { bot: Bot; save: Save }) {
  const n = bot.notify ?? {};
  const chips: [keyof Bot["notify"], string][] = [
    ["needsYou", "It needs me"],
    ["failed", "Something failed"],
    ["finished", "A card finished"],
  ];
  return (
    <Card title="Tell me when">
      <div className="flex flex-wrap gap-2">
        {chips.map(([k, label]) => {
          const on = n[k] !== false;
          return (
            <button
              key={k}
              onClick={() => void save({ notify: { ...n, [k]: !on } as Bot["notify"] })}
              aria-pressed={on}
              className={`rounded-full border px-3 py-1 text-xs ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink"}`}
            >
              {on ? "✓ " : ""}
              {label}
            </button>
          );
        })}
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={!!n.mac} onChange={(e) => void save({ notify: { ...n, mac: e.target.checked } as Bot["notify"] })} />
        Shows on the bell in Vlens. Also send a Mac notification
      </label>
      <p className="mt-1 flex items-center gap-1.5 text-[0.7rem] text-muted">
        <Plug size={11} /> Slack DMs come later.
      </p>
    </Card>
  );
}

// ── Its setup file ───────────────────────────────────────────────────────────

type Mode = "read" | "ai" | "hand";
async function call<T>(url: string, body: object): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? r.statusText);
  return d as T;
}

type View = "agent" | "playbook" | "triggers";

function SetupFile({ bot, onChanged }: { bot: Bot; onChanged: () => void }) {
  const url = `/api/bots/${bot.id}/file`;
  const [files, setFiles] = useState<BotFiles | null>(null);
  const [view, setView] = useState<View>(() => {
    try {
      const v = localStorage.getItem("lens.botSetupTab");
      return v === "agent" || v === "playbook" || v === "triggers" ? v : "triggers";
    } catch {
      return "triggers";
    }
  });
  const [mode, setMode] = useState<Mode>("read");
  const [ask, setAsk] = useState("");
  const [draft, setDraft] = useState<BotFiles | null>(null); // the changed files, being reviewed
  const [hand, setHand] = useState<BotFiles | null>(null);
  const [check, setCheck] = useState<FileCheck | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reviewRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  // A change made further down (a trigger switched) is reviewed up here: bring it into view.
  useEffect(() => {
    if (draft) reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [draft, check]);
  const load = () =>
    fetch(url)
      .then((r) => r.json())
      .then((d) => setFiles(typeof d.agent === "string" ? { agent: d.agent, playbook: d.playbook ?? "" } : { agent: "", playbook: "" }))
      .catch(() => setFiles({ agent: "", playbook: "" }));
  useEffect(() => {
    void load();
  }, [bot.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Changed elsewhere (its chat, another window): show the new files, unless you're editing.
  const updatedKey = JSON.stringify([bot.triggers, bot.rules, bot.allowTools, bot.askTools, bot.denyTools, bot.mcp, bot.role, bot.limits]);
  useEffect(() => {
    if (mode === "read" && !draft) void load();
  }, [updatedKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (v: View) => {
    setView(v);
    try {
      localStorage.setItem("lens.botSetupTab", v);
    } catch {}
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  };
  const review = (f: BotFiles) =>
    run("check", async () => {
      setDraft(f);
      setCheck(await call<FileCheck>(url, { action: "check", ...f }));
    });
  const withAi = () =>
    run("draft", async () => {
      const d = await call<BotFiles>(url, { action: "draft", instruction: ask, ...(files ?? {}) });
      setDraft(d);
      setCheck(await call<FileCheck>(url, { action: "check", ...d }));
    });
  const apply = () =>
    run("apply", async () => {
      await call(url, { action: "apply", ...draft });
      reset();
      await load();
      onChanged();
    });
  const reset = () => {
    setDraft(null);
    setCheck(null);
    setAsk("");
    setMode("read");
  };
  const shown = draft ?? files;
  const parsed = shown ? readBotFiles(shown).file : null;
  const seg = "rounded-md px-2.5 py-1 text-xs";
  const tab = (m: Mode, label: string) => (
    <button
      onClick={() => {
        setMode(mode === m ? "read" : m);
        if (m === "hand") setHand(draft ?? files);
      }}
      aria-pressed={mode === m}
      className={`${seg} ${mode === m ? "bg-bg font-medium shadow-sm" : "text-muted hover:text-ink"}`}
    >
      {label}
    </button>
  );
  return (
    <section className="rounded-2xl border border-line bg-panel p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Its setup</h2>
          <p className="text-[0.7rem] text-muted">
            Two files, like a harness agent: <code className="font-mono">agent.yaml</code> (settings and triggers) and <code className="font-mono">PLAYBOOK.md</code> (what it does when woken).
          </p>
        </div>
        <div className="flex rounded-lg bg-sunken p-0.5">
          {tab("ai", "Edit with AI")}
          {tab("hand", "Edit by hand")}
        </div>
        <button onClick={() => setExporting((v) => !v)} aria-pressed={exporting} className={`rounded-lg border px-2.5 py-1 text-xs ${exporting ? "border-accent text-accent" : "border-line text-muted hover:text-ink"}`}>
          Export for harness
        </button>
      </div>
      {exporting && <ExportPanel botId={bot.id} onClose={() => setExporting(false)} />}
      {mode === "ai" && !draft && (
        <div className="mb-3 space-y-2">
          <textarea
            autoFocus
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            rows={3}
            placeholder='What should change? e.g. "also wake up when CI fails on my PRs", "never merge", "quiet after 8pm", "add a Reviewing part to the playbook"'
            className="w-full resize-y rounded-xl border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button onClick={() => void withAi()} disabled={!ask.trim() || !!busy} className={primary}>
            {busy === "draft" && <Loader2 size={12} className="animate-spin" />} {busy === "draft" ? "Writing the change…" : "Draft the change"}
          </button>
        </div>
      )}
      {mode === "hand" && !draft && hand && (
        <div className="mb-3 space-y-2">
          <FilesEditor files={hand} onChange={setHand} />
          <button onClick={() => void review(hand)} disabled={!!busy} className={primary}>
            {busy === "check" && <Loader2 size={12} className="animate-spin" />} Check it
          </button>
        </div>
      )}
      {err && <p className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">{err}</p>}
      <div ref={reviewRef} className="scroll-mt-4" />
      {busy === "check" && !check && (
        <p className="mb-3 flex items-center gap-1.5 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" /> Checking the change…
        </p>
      )}
      {check && draft && (
        <div className="mb-4">
          <Review
            check={check}
            busy={busy === "apply"}
            onApply={() => void apply()}
            onEdit={() => {
              setHand(draft);
              setDraft(null);
              setCheck(null);
              setMode("hand");
            }}
            onDiscard={reset}
          />
        </div>
      )}
      <div role="tablist" className="mb-3 flex gap-1 border-b border-line">
        {(
          [
            ["triggers", "Triggers", `${parsed?.when.length ?? 0}`],
            ["playbook", "Playbook", "PLAYBOOK.md"],
            ["agent", "Agent", "agent.yaml"],
          ] as const
        ).map(([id, label, sub]) => (
          <button key={id} role="tab" aria-selected={view === id} onClick={() => pick(id)} className={`-mb-px border-b-2 px-3 py-1.5 text-xs ${view === id ? "border-ink font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}>
            {label} <span className={`ml-1 text-[0.65rem] ${id === "triggers" ? "" : "font-mono"} text-muted`}>{sub}</span>
          </button>
        ))}
      </div>
      {files === null ? (
        <Loader2 size={14} className="animate-spin text-muted" />
      ) : !parsed ? (
        <p className="text-xs text-red-600">These files can&apos;t be read. Edit them by hand to fix them.</p>
      ) : view === "triggers" ? (
        <TriggerBoard bot={bot} file={parsed} files={shown!} saved={!draft} onPropose={(agent) => void review({ ...shown!, agent })} />
      ) : view === "playbook" ? (
        <PlaybookView file={parsed} />
      ) : (
        <AgentView file={parsed} />
      )}
      {draft && <p className="mt-2 text-[0.7rem] text-muted">Showing the changed files. Nothing is applied until you press Apply.</p>}
    </section>
  );
}

// This bot as a dev-agent-harness agent, to copy: nothing is sent anywhere.
function ExportPanel({ botId, onClose }: { botId: string; onClose: () => void }) {
  const [d, setD] = useState<{ agent: string; playbook: string; notes: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/bots/${botId}/export`)
      .then((r) => r.json())
      .then((x) => (x.error ? setErr(x.error) : setD(x)))
      .catch((e) => setErr((e as Error).message));
  }, [botId]);
  const copy = (k: string, t: string) => {
    void navigator.clipboard.writeText(t).then(() => {
      setCopied(k);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  return (
    <div className="mb-4 space-y-3 rounded-xl border border-accent/40 bg-accent-soft/20 p-4">
      <div className="flex items-center gap-2">
        <div className="text-sm font-semibold">As a harness agent</div>
        <button onClick={onClose} className="ml-auto text-xs text-muted hover:text-ink">
          Close
        </button>
      </div>
      <p className="text-[0.75rem] text-muted">
        Copy these into a toolkit PR (agents/&lt;name&gt;/), or store it yourself with upsert_agent once its playbook is on a Confluence page. Nothing is sent from here.
      </p>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {!d && !err && <Loader2 size={14} className="animate-spin text-muted" />}
      {d && (
        <>
          <div>
            <div className="mb-1 text-xs font-semibold">What doesn&apos;t carry over</div>
            <ul className="list-disc space-y-0.5 pl-4 text-[0.75rem] text-muted">
              {d.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
          {(
            [
              ["agent", "agent.yaml", d.agent],
              ["playbook", "PLAYBOOK.md", d.playbook],
            ] as const
          ).map(([k, label, text]) => (
            <div key={k}>
              <div className="mb-1 flex items-center gap-2">
                <span className="font-mono text-xs font-semibold">{label}</span>
                <button onClick={() => copy(k, text)} className="ml-auto rounded-md border border-line px-2 py-0.5 text-[0.7rem] hover:border-accent hover:text-accent">
                  {copied === k ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-term px-3 py-2 font-mono text-[0.7rem] text-term-ink scroll-thin">{text}</pre>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
