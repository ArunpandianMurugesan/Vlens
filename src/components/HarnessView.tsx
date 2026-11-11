"use client";

import { ArrowLeft, Ban, CheckCircle2, CircleDashed, CircleSlash, Cloud, ExternalLink, Loader2, LogIn, Pause, Play, RefreshCw, Rocket, Search, Trash2, XCircle } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "./Markdown";

// The Vendasta dev agent harness, operated from Vlens (lib/harness/client.ts: Vlens's
// own sign-in, then the harness's tools directly, no Claude in between):
//   Runs           yours or everyone's, live; open one to follow it as it works, cancel it
//   Agents         every agent, what wakes it, how it's doing; run one now, archive yours
//   Start a task   an ad-hoc run, or an agent with extra instructions
// Every run bills your Claude seat and acts as the harness bot, so anything that
// starts or stops work asks first.

type Run = { id: string; status: string; user: string; agent?: string | null; prompt?: string; createdAt: string; endedAt?: string | null; totalCostUsd?: number | null };
type Agent = { name: string; description?: string; card?: { summary?: string; job?: string; leaves?: string }; enabled?: boolean; source?: string; lifetime?: string; on?: { source: string; events?: string[]; repos?: string[]; projects?: string[]; runAs?: string }[]; schedule?: unknown; lastRun?: { id: string; status: string; createdAt: string } | null; paused?: string | null; owner?: string; runAs?: string };

const btn = "inline-flex items-center gap-1 rounded-lg border border-line bg-bg px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";
const primary = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50";
const field = "rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent";
const LIVE = new Set(["queued", "launching", "gating", "deferred", "running"]);

class SignedOut extends Error {}
async function harness<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch("/api/harness/call", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) });
  const d = await r.json().catch(() => ({}));
  if (d.signedOut) throw new SignedOut(d.error);
  if (!r.ok) throw new Error(d.error ?? r.statusText);
  return d.result as T;
}

const ago = (iso?: string | null) => {
  if (!iso) return "";
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};
const took = (r: Run) => {
  const ms = (r.endedAt ? Date.parse(r.endedAt) : Date.now()) - Date.parse(r.createdAt);
  const m = Math.floor(ms / 60_000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : m ? `${m} min` : `${Math.round(ms / 1000)}s`;
};
const cost = (c?: number | null) => (c == null ? "" : `$${c.toFixed(2)}`);
// A run's prompt starts with its trigger; show what it's about in one line.
const what = (r: Run) => {
  const p = r.prompt ?? "";
  const ev = /## Triggering event \(([^)]+)\)/.exec(p)?.[1];
  const pr = /"html_url":\s*"https:\/\/github\.com\/([^"]+?\/pull\/\d+)"/.exec(p)?.[1] ?? /"number":\s*(\d+)/.exec(p)?.[1];
  const key = /"key":\s*"([A-Z][A-Z0-9]+-\d+)"/.exec(p)?.[1];
  if (ev) return `${ev}${pr ? ` · ${pr.replace("/pull/", "#")}` : key ? ` · ${key}` : ""}`;
  return p.split("\n").find((l) => l.trim())?.slice(0, 140) ?? "";
};

function StatusIcon({ s }: { s: string }) {
  if (LIVE.has(s)) return <Loader2 size={13} className="shrink-0 animate-spin text-accent" />;
  if (s === "succeeded") return <CheckCircle2 size={13} className="shrink-0 text-green-600" />;
  if (s === "failed") return <XCircle size={13} className="shrink-0 text-red-500" />;
  if (s === "cancelled") return <Ban size={13} className="shrink-0 text-muted" />;
  if (s === "skipped") return <CircleSlash size={13} className="shrink-0 text-muted" />;
  return <CircleDashed size={13} className="shrink-0 text-muted" />;
}

export function HarnessView() {
  const [auth, setAuth] = useState<{ signedIn: boolean } | null>(null);
  const [tab, setTab] = useState<"runs" | "agents" | "start">("runs");
  const [me, setMe] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [startWith, setStartWith] = useState<string | null>(null);
  const checkAuth = useCallback(() => fetch("/api/harness/auth").then((r) => r.json()).then(setAuth).catch(() => setAuth({ signedIn: false })), []);
  useEffect(() => {
    void checkAuth();
    fetch("/api/account")
      .then((r) => r.json())
      .then((a) => setMe(a.email ?? null))
      .catch(() => {});
  }, [checkAuth]);
  // Stable, so the lists below don't reload every time the page re-renders (it polls your sessions).
  const out = useCallback(() => setAuth({ signedIn: false }), []);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <Cloud size={18} className="text-accent" />
        <h1 className="text-lg font-semibold">Harness</h1>
        {auth?.signedIn && (
          <nav className="flex rounded-lg bg-sunken p-0.5 text-sm" aria-label="Harness sections">
            {(
              [
                ["runs", "Runs"],
                ["agents", "Agents"],
                ["start", "Start a task"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setTab(id);
                  setOpenRun(null);
                  setOpenAgent(null);
                }}
                aria-pressed={tab === id}
                className={`rounded-md px-3 py-1 ${tab === id ? "bg-bg font-medium shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </nav>
        )}
        <span className="flex-1" />
        {auth?.signedIn && me && <PauseMine email={me} onSignedOut={out} />}
        {auth?.signedIn && (
          <button onClick={() => void fetch("/api/harness/auth", { method: "DELETE" }).then(checkAuth)} className="text-xs text-muted hover:text-ink">
            Sign out
          </button>
        )}
        <a href="https://developer-agent-harness.vendasta-internal.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
          Dashboard <ExternalLink size={11} />
        </a>
      </header>
      {!auth ? (
        <Loader2 size={16} className="m-6 animate-spin text-muted" />
      ) : !auth.signedIn ? (
        <SignIn onDone={checkAuth} />
      ) : tab === "runs" ? (
        openRun ? (
          <RunDetail id={openRun} me={me} onBack={() => setOpenRun(null)} onSignedOut={out} />
        ) : (
          <Runs me={me} onOpen={setOpenRun} onSignedOut={out} />
        )
      ) : tab === "agents" ? (
        openAgent ? (
          <AgentDetail
            name={openAgent}
            me={me}
            onBack={() => setOpenAgent(null)}
            onRun={(id) => {
              setTab("runs");
              setOpenRun(id);
            }}
            onStart={(n) => {
              setStartWith(n);
              setTab("start");
            }}
            onSignedOut={out}
          />
        ) : (
          <Agents me={me} onOpen={setOpenAgent} onSignedOut={out} />
        )
      ) : (
        <Start
          agent={startWith}
          onStarted={(id) => {
            setStartWith(null);
            setTab("runs");
            setOpenRun(id);
          }}
          onSignedOut={out}
        />
      )}
    </div>
  );
}

// ── Sign in ──────────────────────────────────────────────────────────────────

function SignIn({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // While you sign in in the browser, check every few seconds.
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(onDone, 3000);
    return () => clearInterval(t);
  }, [busy, onDone]);
  const go = async () => {
    setErr(null);
    const r = await fetch("/api/harness/auth", { method: "POST" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(d.error ?? r.statusText);
    window.open(d.url, "_blank");
    setBusy(true);
  };
  return (
    <div className="mx-auto mt-16 max-w-md space-y-3 text-center">
      <Cloud size={28} className="mx-auto text-accent" />
      <h2 className="text-lg font-semibold">Connect Vlens to the harness</h2>
      <p className="text-sm text-muted">
        Sign in once with your Vendasta Google account. The harness shows a consent screen naming <b className="font-medium">Vlens</b>: allow it only if you started it here. Vlens then reads runs and agents directly, and starts or stops work only when you press a button.
      </p>
      <button onClick={() => void go()} className={primary}>
        <LogIn size={13} /> {busy ? "Open the sign-in again" : "Sign in to the harness"}
      </button>
      {busy && (
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
          <Loader2 size={12} className="animate-spin" /> Waiting for you to finish in the browser…
        </p>
      )}
      {err && <p className="text-xs text-red-600">{err}</p>}
    </div>
  );
}

function PauseMine({ email, onSignedOut }: { email: string; onSignedOut: () => void }) {
  const [paused, setPaused] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const flip = async () => {
    const next = !paused;
    if (next && !window.confirm(`Pause every harness run billed to ${email}? Your agents' event and schedule runs are skipped (not replayed later), and new runs are refused, until you resume.`)) return;
    setBusy(true);
    try {
      await harness("pause_credential", { email, paused: next });
      setPaused(next);
    } catch (e) {
      if (e instanceof SignedOut) onSignedOut();
      else window.alert((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <button onClick={() => void flip()} disabled={busy} className={btn} title="Pause or resume every harness run billed to your Claude seat">
      {busy ? <Loader2 size={11} className="animate-spin" /> : paused ? <Play size={11} /> : <Pause size={11} />} {paused ? "Resume my runs" : "Pause my runs"}
    </button>
  );
}

// ── Runs ─────────────────────────────────────────────────────────────────────

function Runs({ me, onOpen, onSignedOut }: { me: string | null; onOpen: (id: string) => void; onSignedOut: () => void }) {
  const [who, setWho] = useState<"mine" | "all">("mine");
  const [status, setStatus] = useState("");
  const [agent, setAgent] = useState("");
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setRuns(await harness<Run[]>("list_runs", { limit: 60, ...(who === "all" ? { all: true } : {}), ...(status ? { status } : {}), ...(agent.trim() ? { agent: agent.trim() } : {}) }));
      setErr(null);
    } catch (e) {
      if (e instanceof SignedOut) onSignedOut();
      else setErr((e as Error).message);
    }
  }, [who, status, agent, onSignedOut]);
  // Loads when you open it or change a filter; after that, only when you press Refresh.
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    await load();
    setLoadedAt(new Date().toISOString());
    setBusy(false);
  }, [load]);
  useEffect(() => {
    setRuns(null);
    void refresh();
  }, [refresh]);
  const live = (runs ?? []).filter((r) => LIVE.has(r.status)).length;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 scroll-thin">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-sunken p-0.5 text-xs">
          {(["mine", "all"] as const).map((w) => (
            <button key={w} onClick={() => setWho(w)} aria-pressed={who === w} className={`rounded-md px-2.5 py-1 ${who === w ? "bg-bg font-medium shadow-sm" : "text-muted"}`}>
              {w === "mine" ? "Mine" : "Everyone"}
            </button>
          ))}
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={`${field} py-1 text-xs`} aria-label="Status">
          <option value="">Any status</option>
          {["running", "queued", "succeeded", "failed", "cancelled", "skipped"].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="Agent, like pr-review" className={`${field} w-48 py-1 text-xs`} />
        <span className="text-xs text-muted">
          {live ? `${live} working · ` : ""}
          {loadedAt ? `as of ${new Date(loadedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
        </span>
        <button onClick={() => void refresh()} disabled={busy} className={`${btn} ml-auto`}>
          <RefreshCw size={11} className={busy ? "animate-spin" : ""} /> Refresh
        </button>
      </div>
      {err && <p className="mb-2 text-xs text-red-600">{err}</p>}
      {!runs ? (
        <Loader2 size={16} className="animate-spin text-muted" />
      ) : !runs.length ? (
        <p className="text-sm text-muted">No runs{who === "mine" ? " of yours" : ""} match.</p>
      ) : (
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {runs.map((r) => (
            <button key={r.id} onClick={() => onOpen(r.id)} className="flex w-full items-center gap-3 bg-panel px-3 py-2 text-left text-sm hover:bg-sunken/60">
              <StatusIcon s={r.status} />
              <span className="w-40 shrink-0 truncate font-medium">{r.agent ?? "ad-hoc"}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted">{what(r)}</span>
              {who === "all" && <span className="w-36 shrink-0 truncate text-xs text-muted">{r.user === me ? "you" : r.user.replace(/@vendasta\.com$/, "")}</span>}
              <span className="w-16 shrink-0 text-right text-xs text-muted">{took(r)}</span>
              <span className="w-14 shrink-0 text-right text-xs text-muted">{cost(r.totalCostUsd)}</span>
              <span className="w-20 shrink-0 text-right text-xs text-muted">{ago(r.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Ev = { seq: number; type: string; text?: string; tool?: string; name?: string; input?: unknown; message?: unknown; status?: string; at?: string; createdAt?: string; data?: unknown };

// One event, in a line: what it said or did.
function evLine(e: Ev): { kind: string; text: string } {
  const d = (e.data ?? e.message ?? e) as Record<string, unknown>;
  const pick = (o: unknown): string => {
    if (typeof o === "string") return o;
    if (!o || typeof o !== "object") return "";
    const r = o as Record<string, unknown>;
    if (typeof r.text === "string") return r.text;
    if (Array.isArray(r.content)) return r.content.map(pick).filter(Boolean).join("\n");
    if (r.message) return pick(r.message);
    return "";
  };
  if (e.type === "tool_use") {
    const name = String(d.name ?? e.name ?? e.tool ?? "tool");
    const inp = (d.input ?? e.input ?? {}) as Record<string, unknown>;
    const arg = String(inp.command ?? inp.file_path ?? inp.pattern ?? inp.url ?? inp.description ?? "").split("\n")[0];
    return { kind: "tool", text: `${name}${arg ? ` · ${arg.slice(0, 160)}` : ""}` };
  }
  if (e.type === "status") return { kind: "status", text: `status: ${String(d.status ?? e.status ?? pick(d))}` };
  return { kind: e.type, text: pick(d) || pick(e) };
}

function RunDetail({ id, me, onBack, onSignedOut }: { id: string; me: string | null; onBack: () => void; onSignedOut: () => void }) {
  const [run, setRun] = useState<Record<string, unknown> | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const after = useRef(-1);
  const box = useRef<HTMLDivElement>(null);
  const status = String(run?.status ?? "");
  const live = LIVE.has(status);
  const fail = (e: unknown) => (e instanceof SignedOut ? onSignedOut() : setErr((e as Error).message));
  const loadRun = useCallback(() => harness<Record<string, unknown>>("get_run", { runId: id }).then(setRun).catch(fail), [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadEvents = useCallback(async () => {
    try {
      for (let i = 0; i < 5; i++) {
        const d = await harness<{ events?: Ev[]; nextAfter?: number | null } | Ev[]>("run_events", { runId: id, after: after.current, limit: 200 });
        const evs = Array.isArray(d) ? d : (d.events ?? []);
        if (!evs.length) break;
        after.current = evs[evs.length - 1].seq;
        setEvents((x) => [...x, ...evs]);
        if (Array.isArray(d) || d.nextAfter == null) break;
      }
    } catch (e) {
      fail(e);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    after.current = -1;
    setEvents([]);
    void loadRun();
    void loadEvents();
  }, [loadRun, loadEvents]);
  // Follow it while it works.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      void loadRun();
      void loadEvents();
    }, 3000);
    return () => clearInterval(t);
  }, [live, loadRun, loadEvents]);
  useEffect(() => {
    const el = box.current;
    if (el && live) el.scrollTop = el.scrollHeight;
  }, [events.length, live]);
  const cancel = async () => {
    if (!window.confirm("Cancel this run? It stops where it is.")) return;
    setBusy("cancel");
    try {
      await harness("cancel_run", { runId: id });
      await loadRun();
    } catch (e) {
      fail(e);
    }
    setBusy(null);
  };
  const readTranscript = async () => {
    setBusy("transcript");
    try {
      const d = await harness<string | { text?: string; entries?: unknown[] }>("run_transcript", { runId: id, format: "text", limit: 500 });
      setTranscript(typeof d === "string" ? d : (d.text ?? JSON.stringify(d, null, 2)));
    } catch (e) {
      fail(e);
    }
    setBusy(null);
  };
  const lines = events.map(evLine).filter((l) => l.text.trim());
  const mine = run?.user === me;
  const result = String(run?.resultText ?? run?.result ?? "");
  return (
    <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1 rounded-lg bg-sunken px-2.5 py-1 text-xs hover:text-accent">
          <ArrowLeft size={13} /> Runs
        </button>
        <StatusIcon s={status} />
        <span className="font-medium">{String(run?.agent ?? "ad-hoc run")}</span>
        <span className="text-xs text-muted">
          {status}
          {run?.user ? ` · ${run.user === me ? "you" : String(run.user)}` : ""}
          {run?.createdAt ? ` · started ${ago(String(run.createdAt))}` : ""}
          {run?.totalCostUsd != null ? ` · ${cost(Number(run.totalCostUsd))}` : ""}
          {run?.numTurns != null ? ` · ${String(run.numTurns)} turns` : ""}
        </span>
        <span className="flex-1" />
        {live && mine && (
          <button onClick={() => void cancel()} disabled={!!busy} className={`${btn} text-red-600`}>
            {busy === "cancel" ? <Loader2 size={11} className="animate-spin" /> : <Ban size={11} />} Cancel run
          </button>
        )}
        <button onClick={() => void readTranscript()} disabled={!!busy} className={btn}>
          {busy === "transcript" ? <Loader2 size={11} className="animate-spin" /> : null} Full transcript
        </button>
        <a href={`https://developer-agent-harness.vendasta-internal.com/runs/${id}`} target="_blank" rel="noreferrer" className={btn}>
          Open in dashboard <ExternalLink size={11} />
        </a>
      </div>
      {err && <p className="mb-2 text-xs text-red-600">{err}</p>}
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div ref={box} className="min-h-0 space-y-1 overflow-y-auto rounded-xl border border-line bg-panel p-3 font-mono text-[0.75rem] scroll-thin">
          {transcript !== null ? (
            <pre className="whitespace-pre-wrap">{transcript}</pre>
          ) : !lines.length ? (
            <p className="text-muted">{run ? "No events yet." : "Loading…"}</p>
          ) : (
            lines.map((l, i) => (
              <div key={i} className={l.kind === "tool" ? "text-accent" : l.kind === "status" ? "text-muted" : l.kind === "result" ? "font-semibold" : ""}>
                <span className="mr-2 select-none text-muted">{l.kind === "assistant" ? "›" : l.kind === "tool" ? "⚙" : "·"}</span>
                <span className="whitespace-pre-wrap">{l.text.length > 1200 ? `${l.text.slice(0, 1200)}…` : l.text}</span>
              </div>
            ))
          )}
          {live && transcript === null && (
            <p className="flex items-center gap-1.5 text-muted">
              <Loader2 size={11} className="animate-spin" /> working…
            </p>
          )}
        </div>
        <aside className="min-h-0 space-y-3 overflow-y-auto scroll-thin">
          <section className="rounded-xl border border-line bg-panel p-3 text-sm">
            <div className="mb-1 text-xs font-semibold text-muted">Result</div>
            {result ? <Markdown text={result} /> : <p className="text-xs text-muted">{live ? "Not finished yet." : "No result text."}</p>}
          </section>
          {typeof run?.prompt === "string" && (
            <details className="rounded-xl border border-line bg-panel p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-muted">What it was asked</summary>
              <pre className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap scroll-thin">{run.prompt}</pre>
            </details>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Agents ───────────────────────────────────────────────────────────────────

const triggerText = (a: Agent) => {
  const bits = (a.on ?? []).map((o) => `${o.source}${o.events?.length ? ` ${o.events.slice(0, 2).join(", ")}${o.events.length > 2 ? "…" : ""}` : ""}${o.repos?.length ? ` · ${o.repos.slice(0, 2).join(", ")}${o.repos.length > 2 ? "…" : ""}` : ""}${o.projects?.length ? ` · ${o.projects.join(", ")}` : ""}`);
  if (a.schedule) bits.push("schedule");
  return bits.join(" · ") || "only when started";
};

function Agents({ me, onOpen, onSignedOut }: { me: string | null; onOpen: (n: string) => void; onSignedOut: () => void }) {
  const [list, setList] = useState<Agent[] | null>(null);
  const [q, setQ] = useState("");
  const [which, setWhich] = useState<"mine" | "shared" | "all">("all");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    harness<Agent[] | { agents: Agent[] }>("list_agents")
      .then((d) => setList(Array.isArray(d) ? d : d.agents))
      .catch((e) => (e instanceof SignedOut ? onSignedOut() : setErr((e as Error).message)));
  }, [onSignedOut]);
  const isMine = useCallback((a: Agent) => !!me && JSON.stringify(a).includes(me), [me]);
  const shown = useMemo(
    () =>
      (list ?? [])
        .filter((a) => which === "all" || (which === "mine" ? isMine(a) : a.source === "shared"))
        .filter((a) => !q.trim() || `${a.name} ${a.description ?? ""} ${a.card?.summary ?? ""}`.toLowerCase().includes(q.trim().toLowerCase())),
    [list, which, q, isMine],
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 scroll-thin">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg bg-sunken p-0.5 text-xs">
          {(["all", "mine", "shared"] as const).map((w) => (
            <button key={w} onClick={() => setWhich(w)} aria-pressed={which === w} className={`rounded-md px-2.5 py-1 ${which === w ? "bg-bg font-medium shadow-sm" : "text-muted"}`}>
              {w === "all" ? "All" : w === "mine" ? "Mine" : "Shared"}
            </button>
          ))}
        </div>
        <span className="relative">
          <Search size={12} className="absolute left-2.5 top-2 text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an agent" className={`${field} w-60 py-1 pl-7 text-xs`} />
        </span>
        {list && <span className="text-xs text-muted">{shown.length} of {list.length}</span>}
      </div>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {!list ? (
        <Loader2 size={16} className="animate-spin text-muted" />
      ) : (
        <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {shown.map((a) => (
            <button key={a.name} onClick={() => onOpen(a.name)} className="flex flex-col gap-1.5 rounded-xl border border-line bg-panel p-3 text-left hover:border-accent/50">
              <span className="flex items-center gap-2">
                <span className="truncate font-mono text-sm font-semibold">{a.name}</span>
                {isMine(a) && <span className="rounded bg-accent-soft px-1.5 text-[0.65rem] text-accent">yours</span>}
                <span className="ml-auto shrink-0 rounded bg-sunken px-1.5 text-[0.65rem] text-muted">{a.source}</span>
              </span>
              <span className="line-clamp-2 text-xs text-muted">{a.card?.summary ?? a.description}</span>
              <span className="truncate text-[0.7rem] text-muted">{triggerText(a)}</span>
              <span className="flex items-center gap-1.5 text-[0.7rem] text-muted">
                {a.lastRun ? (
                  <>
                    <StatusIcon s={a.lastRun.status} /> last run {ago(a.lastRun.createdAt)}
                  </>
                ) : (
                  "never run"
                )}
                {a.paused && <span className="ml-auto text-amber-700 dark:text-amber-400">paused</span>}
                {a.enabled === false && <span className="ml-auto text-muted">off</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentDetail({ name, me, onBack, onRun, onStart, onSignedOut }: { name: string; me: string | null; onBack: () => void; onRun: (id: string) => void; onStart: (n: string) => void; onSignedOut: () => void }) {
  const [a, setA] = useState<Record<string, unknown> | null>(null);
  const [health, setHealth] = useState<{ runs?: Run[]; recent?: Run[]; lastFailure?: { id?: string; reason?: string; resultText?: string; createdAt?: string } | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const fail = (e: unknown) => (e instanceof SignedOut ? onSignedOut() : setErr((e as Error).message));
  useEffect(() => {
    harness<Record<string, unknown>>("get_agent", { name }).then(setA).catch(fail);
    harness<typeof health>("get_agent_health", { name, limit: 10 }).then(setHealth).catch(() => {});
  }, [name]); // eslint-disable-line react-hooks/exhaustive-deps
  const def = (a?.definition ?? a?.agent ?? a) as Agent & Record<string, unknown> | undefined;
  const playbook = String(a?.playbook ?? def?.playbook ?? "");
  const mine = !!me && !!a && JSON.stringify(def ?? {}).includes(me) && def?.source !== "shared";
  const runNow = async () => {
    if (!window.confirm(`Run ${name} now? It runs in the cloud as the harness bot and bills your Claude seat.`)) return;
    setBusy("run");
    try {
      const r = await harness<{ id?: string; runId?: string }>("submit_run", { agent: name });
      const id = r.id ?? r.runId;
      if (id) onRun(id);
    } catch (e) {
      fail(e);
    }
    setBusy(null);
  };
  const archive = async () => {
    if (!window.confirm(`Archive ${name}? It stops being listed and stops firing. Runs already made stay.`)) return;
    setBusy("archive");
    try {
      await harness("archive_agent", { name });
      onBack();
    } catch (e) {
      fail(e);
    }
    setBusy(null);
  };
  const recent = health?.runs ?? health?.recent ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 scroll-thin">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1 rounded-lg bg-sunken px-2.5 py-1 text-xs hover:text-accent">
          <ArrowLeft size={13} /> Agents
        </button>
        <span className="font-mono text-base font-semibold">{name}</span>
        {def?.source && <span className="rounded bg-sunken px-1.5 text-[0.65rem] text-muted">{String(def.source)}</span>}
        {mine && <span className="rounded bg-accent-soft px-1.5 text-[0.65rem] text-accent">yours</span>}
        <span className="flex-1" />
        <button onClick={() => void runNow()} disabled={!!busy || !a} className={primary}>
          {busy === "run" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Run now
        </button>
        <button onClick={() => onStart(name)} className={btn}>
          <Rocket size={11} /> Run with instructions
        </button>
        {mine && (
          <button onClick={() => void archive()} disabled={!!busy} className={`${btn} text-red-600`}>
            <Trash2 size={11} /> Archive
          </button>
        )}
      </div>
      {err && <p className="mb-2 text-xs text-red-600">{err}</p>}
      {!a ? (
        <Loader2 size={16} className="animate-spin text-muted" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="space-y-3">
            <Box title="What it does">
              <p className="text-sm">{String(def?.description ?? def?.card?.summary ?? "")}</p>
              <p className="mt-1 text-xs text-muted">Wakes on: {def ? triggerText(def as Agent) : ""}</p>
            </Box>
            <Box title="Playbook">{playbook ? <Markdown text={playbook} /> : <p className="text-xs text-muted">No playbook text (it may read one from Confluence).</p>}</Box>
            <details className="rounded-xl border border-line bg-panel p-3 text-xs">
              <summary className="cursor-pointer font-semibold text-muted">Its full definition</summary>
              <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap scroll-thin">{JSON.stringify(def, null, 2)}</pre>
            </details>
          </div>
          <aside className="space-y-3">
            <Box title="How it's doing">
              {health?.lastFailure ? (
                <p className="mb-2 text-xs text-red-600">
                  Last failure {ago(health.lastFailure.createdAt)}: {String(health.lastFailure.reason ?? health.lastFailure.resultText ?? "").slice(0, 300)}
                </p>
              ) : (
                <p className="mb-2 text-xs text-muted">No failures on record.</p>
              )}
              <div className="divide-y divide-line">
                {recent.map((r) => (
                  <button key={r.id} onClick={() => onRun(r.id)} className="flex w-full items-center gap-2 py-1.5 text-left text-xs hover:text-accent">
                    <StatusIcon s={r.status} />
                    <span className="min-w-0 flex-1 truncate">{what(r)}</span>
                    <span className="text-muted">{ago(r.createdAt)}</span>
                  </button>
                ))}
                {!recent.length && <p className="text-xs text-muted">No runs yet.</p>}
              </div>
            </Box>
          </aside>
        </div>
      )}
    </div>
  );
}

const Box = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="rounded-xl border border-line bg-panel p-3">
    <div className="mb-1.5 text-xs font-semibold text-muted">{title}</div>
    {children}
  </section>
);

// ── Start a task ─────────────────────────────────────────────────────────────

function Start({ agent: preset, onStarted, onSignedOut }: { agent: string | null; onStarted: (id: string) => void; onSignedOut: () => void }) {
  const [agent, setAgent] = useState(preset ?? "");
  const [prompt, setPrompt] = useState("");
  const [repos, setRepos] = useState("");
  const [jira, setJira] = useState("");
  const [confluence, setConfluence] = useState(false);
  const [effort, setEffort] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    const repoList = repos.split(/[\s,]+/).filter(Boolean);
    const bad = repoList.find((r) => !/^[\w.-]+\/[\w.-]+$/.test(r));
    if (bad) return setErr(`"${bad}" should be org/name, like vendasta/galaxy.`);
    if (!agent.trim() && !prompt.trim()) return setErr("Say what it should do, or pick an agent.");
    if (!window.confirm(`Start ${agent.trim() ? `${agent.trim()}` : "this task"} in the harness? It runs in the cloud as the harness bot and bills your Claude seat.`)) return;
    setBusy(true);
    setErr(null);
    const tools: unknown[] = [];
    if (!agent.trim()) {
      const projects = jira.split(/[\s,]+/).filter(Boolean).map((p) => p.toUpperCase());
      if (projects.length) tools.push({ jira: { projects, readOnly: true } });
      if (confluence) tools.push("confluence");
    }
    try {
      const r = await harness<{ id?: string; runId?: string }>("submit_run", {
        ...(agent.trim() ? { agent: agent.trim() } : {}),
        ...(prompt.trim() ? { prompt: prompt.trim() } : {}),
        ...(repoList.length ? { repos: repoList } : {}),
        ...(tools.length ? { tools } : {}),
        ...(effort ? { effort } : {}),
      });
      const id = r.id ?? r.runId;
      if (id) onStarted(id);
    } catch (e) {
      if (e instanceof SignedOut) onSignedOut();
      else setErr((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 scroll-thin">
      <div className="mx-auto max-w-2xl space-y-3">
        <p className="text-sm text-muted">Hand off work that should run without you: an investigation, a migration, a fix. It runs in the cloud, keeps going after you close Vlens, and leaves a result (a PR, a comment, a report). You can follow it in Runs.</p>
        <label className="block space-y-1">
          <span className="text-sm font-medium">What should it do?</span>
          <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} placeholder="Why did Tuesday's deploy of marketplace roll back? Check the logs and the PRs merged that day, and report the cause." className={`${field} w-full resize-y`} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Agent (optional)</span>
            <input value={agent} onChange={(e) => setAgent(e.target.value)} placeholder="pr-review" className={`${field} w-full font-mono`} />
            <span className="block text-[0.7rem] text-muted">With an agent, it follows that agent&apos;s playbook and your text is extra instructions.</span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Repos to clone</span>
            <input value={repos} onChange={(e) => setRepos(e.target.value)} placeholder="vendasta/galaxy, vendasta/marketplace" className={`${field} w-full font-mono`} />
          </label>
        </div>
        {!agent.trim() && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1">
              <span className="text-sm font-medium">Jira projects it may read</span>
              <input value={jira} onChange={(e) => setJira(e.target.value)} placeholder="XPAN, TLKM" className={`${field} w-full font-mono`} />
            </label>
            <label className="flex items-center gap-2 pt-6 text-sm">
              <input type="checkbox" checked={confluence} onChange={(e) => setConfluence(e.target.checked)} /> It may read Confluence
            </label>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm">
          Effort
          <select value={effort} onChange={(e) => setEffort(e.target.value)} className={`${field} py-1`}>
            <option value="">default</option>
            {["low", "medium", "high", "xhigh"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button onClick={() => void go()} disabled={busy} className={primary}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Rocket size={12} />} Start in the harness
        </button>
      </div>
    </div>
  );
}
