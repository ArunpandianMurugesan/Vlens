"use client";

import { ArrowDown, ArrowUp, Bot, Check, ChevronLeft, ChevronRight, Hand, Loader2, Pause, Play, Plus, RotateCcw, Settings2, Trash2, Zap } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { Review } from "@/hooks/useReview";
import {
  type Activity,
  type AutopilotRules,
  DEFAULT_RULES,
  type Depth,
  DEPTH_LABEL,
  LANE_LABEL,
  type Plan,
  PLAN_LABEL,
  type PlanState,
  planFor,
  THEN_LABEL,
  type Workflow,
  type WorkflowLane,
  type WorkflowThen,
} from "@/lib/autopilotPlan";
import type { Risk } from "@/lib/risk";
import type { PrSummary } from "@/lib/types";
import { RiskBadge } from "./RiskBadge";
import { ago } from "./ReviewSidebar";
import { MenuButton } from "./Sidebar";

// Autopilot in PR Review: a status chip on each PR, its own sidebar tab (what it
// handed back, what's queued, what it did), the Rules page, and a card on a PR's
// Overview. The runner (autopilotRunner.ts) does the reviews; this is where you watch it.

const CHIP: Record<PlanState, string> = {
  handoff: "bg-danger/10 text-danger",
  changed: "bg-warning/15 text-warning",
  queued: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
  reviewed: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  posted: "bg-success/10 text-success",
  paused: "bg-sunken text-muted",
  skip: "bg-sunken text-muted",
};

// Rows in the Reviews and My PRs lists show only what's news: not "skipped", and
// "queued" only while autopilot is on.
export function PlanChip({ plan, enabled, always = false }: { plan: Plan | null; enabled: boolean; always?: boolean }) {
  if (!plan) return null;
  if (!always && (plan.state === "skip" || (plan.state === "queued" && !enabled))) return null;
  return (
    <span title={`Autopilot: ${plan.why}`} className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[0.65rem] ${CHIP[plan.state]}`}>
      <Bot size={10} /> {PLAN_LABEL[plan.state]}
    </span>
  );
}

const ACT_ICON: Record<Activity["kind"], string> = {
  reviewed: "🔍",
  posted: "📮",
  handed: "✋",
  skipped: "⏭",
  paused: "⏸",
  resumed: "▶️",
  rules: "⚙️",
  error: "⚠️",
};

// On a PR's Overview: what autopilot thinks of this PR, and a Pause for it.
export function AutomationCard({ review, pr }: { review: Review; pr: PrSummary }) {
  const { auto, planOf, setPaused, setRulesOpen } = review;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const plan = planOf(pr);
  if (!auto || !plan) return null;
  const t = auto.tracks[pr.url];
  const paused = !!auto.paused[pr.url];
  const wf = auto.rules.workflows.find((w) => w.id === plan.workflow?.id);
  const toggle = async () => {
    setBusy(true);
    setErr(null);
    await setPaused(pr, !paused).catch((e: Error) => setErr(`Couldn't ${paused ? "resume" : "pause"}: ${e.message}`));
    setBusy(false);
  };
  return (
    <section className="rounded-2xl border border-line bg-panel px-4 py-3.5">
      <div className="mb-2.5 flex items-center gap-2">
        <Bot size={14} className={auto.rules.enabled ? "text-accent" : "text-muted"} />
        <h2 className="text-sm font-semibold">Automation</h2>
        <PlanChip plan={plan} enabled={auto.rules.enabled} always />
        <button onClick={() => setRulesOpen(true)} className="ml-auto text-xs text-muted hover:text-accent">
          Settings
        </button>
      </div>
      <p className="text-sm">{sentence(plan, auto.rules.enabled)}</p>
      {wf && (
        <p className="mt-1 text-xs text-muted">
          Workflow: {wf.name} · {THEN_LABEL[wf.then]} · {DEPTH_LABEL[wf.depth].split(":")[0]}
        </p>
      )}
      <ul className="mt-2 space-y-0.5 text-xs text-muted">
        <li>Last review: {t?.lastRun ? `${ago(t.lastRun.at)} ago, at ${t.lastRun.headSha.slice(0, 7)}` : "none yet"}</li>
        <li>
          Last posted:{" "}
          {t?.lastPost ? (
            <a href={t.lastPost.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
              {ago(t.lastPost.at)} ago, at {t.lastPost.headSha.slice(0, 7)}
            </a>
          ) : (
            "never"
          )}
        </li>
        <li>PR now at {pr.headSha.slice(0, 7) || "?"}</li>
      </ul>
      <button onClick={() => void toggle()} disabled={busy} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50">
        {paused ? <Play size={12} /> : <Pause size={12} />} {paused ? "Resume autopilot here" : "Pause autopilot for this PR"}
      </button>
      {err && <p className="mt-1.5 text-xs text-danger">{err}</p>}
    </section>
  );
}

function sentence(plan: Plan, enabled: boolean) {
  switch (plan.state) {
    case "posted":
      return "Done: a review is posted at the PR's current commit.";
    case "reviewed":
      return "Reviewed at the current commit. Its draft comments wait for you in the Discussion tab; nothing is posted yet.";
    case "changed":
      return `The PR moved on since the last review (${plan.why}). ${enabled ? "Autopilot would review it again." : "Worth another review."}`;
    case "queued":
      return enabled ? "In the queue: autopilot would review it next." : "Autopilot would review this one once it's on.";
    case "handoff":
      return `This one is yours: ${plan.why}.`;
    case "paused":
      return "Paused: autopilot leaves this PR alone.";
    case "skip":
      return `Autopilot skips it: ${plan.why}.`;
  }
}

// ── The board: what autopilot does with every PR, in the main area ──

export function AutopilotBoard({ review, onMenu }: { review: Review; onMenu: () => void }) {
  const { auto, prs, setRulesOpen, saveRules, setPaused, select, runAction } = review;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (action: "run" | "stop" | "retry", url?: string) => {
    setBusy(true);
    setNote(await runAction(action, url));
    setBusy(false);
  };
  const [folded, setFolded] = useState(true);
  const plans = useMemo(() => (auto ? prs.map((p) => ({ p, plan: planFor(p, auto) })) : []), [prs, auto]);
  if (!auto) return <main className="flex flex-1 items-center justify-center text-sm text-muted">Loading autopilot…</main>;
  const r = auto.rules;
  const by = (...states: PlanState[]) => plans.filter((x) => states.includes(x.plan.state));
  const wfOf = (id?: string) => r.workflows.find((w) => w.id === id);
  // Re-checks of PRs that moved on wait in the queue when their workflow re-checks; otherwise they need you.
  const changed = by("changed");
  const running = auto.running;
  const full = running.length >= r.workers; // every worker busy
  const failedHere = (p: PrSummary) => auto.failed[p.url]?.headSha === p.headSha;
  const failed = plans.filter((x) => failedHere(x.p));
  // A PR that moved on since its review needs you only when its workflow doesn't re-check it.
  const recheckOff = (x: { plan: Plan }) => {
    const wf = wfOf(x.plan.workflow?.id);
    return !!wf && !wf.recheck;
  };
  const needsYou = [...by("handoff"), ...changed.filter(recheckOff)].filter((x) => !failedHere(x.p));
  const queue = [...changed.filter((x) => wfOf(x.plan.workflow?.id)?.recheck), ...by("queued")].filter((x) => !failedHere(x.p) && !running.some((x2) => x2.url === x.p.url));
  const nextIn = r.enabled && auto.lastCheck ? Math.max(0, Math.ceil((Date.parse(auto.lastCheck) + r.intervalMinutes * 60_000 - Date.now()) / 60_000)) : null;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = Object.entries(auto.tracks)
    .filter(([, t]) => t.lastRun && Date.parse(t.lastRun.at) >= startOfDay.getTime())
    .sort(([, a], [, b]) => b.lastRun!.at.localeCompare(a.lastRun!.at));
  const toggle = async () => {
    setBusy(true);
    setErr(null);
    await saveRules({ ...r, enabled: !r.enabled }).catch((e: Error) => setErr(`Couldn't ${r.enabled ? "pause" : "turn on"} autopilot: ${e.message}`));
    setBusy(false);
  };
  const open = (url: string) => void select(url);
  const pause = (p: PrSummary, v: boolean) => setPaused(p, v).catch((e: Error) => setErr(`Couldn't ${v ? "pause" : "resume"} ${p.repo.split("/")[1]} #${p.number}: ${e.message}`));
  const label = (url: string) => {
    const p = prs.find((x) => x.url === url);
    const m = url.match(/github\.com\/[^/]+\/([^/]+)\/pull\/(\d+)/);
    return { title: p?.title ?? (m ? `${m[1]} #${m[2]}` : url), where: m ? `${m[1]} #${m[2]}` : "" };
  };
  const skipped = by("skip");
  const paused = by("paused");

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <MenuButton onClick={onMenu} />
        <button onClick={() => review.goInbox()} className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-sunken py-1 pl-1 pr-2 text-xs hover:text-accent">
          <ChevronLeft size={14} /> PR Review
        </button>
        <Bot size={16} className={r.enabled ? "text-accent" : "text-muted"} />
        <h1 className="text-sm font-semibold">Autopilot</h1>
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${r.enabled ? "bg-success/10 text-success" : "bg-sunken text-muted"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${r.enabled ? "bg-success" : "bg-muted"}`} aria-hidden /> {r.enabled ? "On" : "Off"}
        </span>
        <span className="text-xs text-muted">
          {auto.today} reviews today · {running.length} of {r.workers} workers busy · {nextIn === null ? `checks every ${r.intervalMinutes} min` : nextIn === 0 ? "checking soon" : `next check in ${nextIn} min`}
        </span>
        {note && <span className="text-xs text-accent">{note}</span>}
        {err && <span role="alert" className="text-xs text-danger">{err}</span>}
        <span className="ml-auto flex items-center gap-2">
          <button onClick={() => void act("run")} disabled={busy || full} title={full ? `All ${r.workers} workers are busy` : "Fill the free workers from the queue now, even when autopilot is off"} className={btnS}>
            <Zap size={12} /> Run now
          </button>
          <button onClick={() => void toggle()} disabled={busy} className={btnS}>
            {r.enabled ? <Pause size={12} /> : <Play size={12} />} {r.enabled ? "Pause" : "Turn on"}
          </button>
          <button onClick={() => setRulesOpen(true)} className={btnS}>
            <Settings2 size={12} /> Settings
          </button>
        </span>
      </header>
      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="grid items-start gap-4 px-6 py-5 md:grid-cols-2 xl:grid-cols-4">
          <Column title="Needs you" n={needsYou.length + failed.length} tone="text-amber-800 dark:text-amber-300" dot="bg-amber-600" box="border-amber-500/40 bg-amber-500/5" empty="Nothing handed to you.">
            {failed.map(({ p }) => (
              <BoardCard key={p.url} risk={review.riskOf(p)} title={p.title} where={`${p.repo.split("/")[1]} #${p.number}`} why={`Review failed: ${auto.failed[p.url].error}`} tone="border-red-500/30 bg-red-500/5">
                <button onClick={() => void act("retry", p.url)} disabled={busy || full} className={btnS}>
                  Retry
                </button>
                <button onClick={() => open(p.url)} className={btnS}>
                  Review it myself
                </button>
              </BoardCard>
            ))}
            {needsYou.map(({ p, plan }) => (
              <BoardCard key={p.url} risk={review.riskOf(p)} title={p.title} where={`${p.repo.split("/")[1]} #${p.number}`} wf={plan.workflow?.name} why={plan.state === "handoff" ? `Handed to you: ${plan.why}` : plan.why} tone="border-red-500/30 bg-red-500/5">
                <button onClick={() => open(p.url)} className={btnS}>
                  Review it myself
                </button>
                <button onClick={() => void pause(p, true)} className={btnS}>
                  Leave it
                </button>
              </BoardCard>
            ))}
          </Column>
          <Column title={`Running (${r.workers} at once)`} n={running.length} tone="" dot="bg-emerald-500" empty={r.enabled ? "Nothing running. The next check fills the workers from the top of the queue." : "Nothing running. Autopilot is off: turn it on, or press Run now."}>
            {running.map((run) => (
              <BoardCard key={run.url} title={run.title} where={`${label(run.url).where} · ${run.workflow}`} why={`Started ${ago(run.startedAt)} ago at ${run.headSha.slice(0, 7)}`} tone="border-sky-500/30 bg-sky-500/5">
                <ol className="w-full space-y-0.5 text-xs">
                  {run.steps.map((s, i) => {
                    const lastStep = i === run.steps.length - 1;
                    return (
                      <li key={`${s.at}-${i}`} className={`flex items-center gap-1.5 ${lastStep ? "font-medium" : "text-muted"}`}>
                        {lastStep ? <Loader2 size={11} className="shrink-0 animate-spin text-sky-600" /> : <Check size={11} className="shrink-0 text-success" />}
                        <span className="min-w-0 truncate">{s.text}</span>
                      </li>
                    );
                  })}
                  {!run.steps.length && <li className="text-muted">Starting…</li>}
                </ol>
                {prs.some((x) => x.url === run.url) && (
                  <button onClick={() => open(run.url)} className={btnS}>
                    Watch
                  </button>
                )}
                <button onClick={() => void act("stop", run.url)} disabled={busy} className={btnS}>
                  Stop
                </button>
              </BoardCard>
            ))}
          </Column>
          <Column title="In queue" n={queue.length} tone="" dot="bg-violet-500" empty="The queue is empty.">
            {queue.map(({ p, plan }, i) => (
              <BoardCard key={p.url} n={i + 1} risk={review.riskOf(p)} title={p.title} where={`${p.repo.split("/")[1]} #${p.number}`} wf={plan.workflow?.name} why={plan.state === "changed" ? "re-check after new commits" : i < r.workers - running.length ? "next up" : "waiting for a free worker"}>
                <button onClick={() => open(p.url)} className={btnS}>
                  Open
                </button>
                <button onClick={() => void pause(p, true)} className={btnS}>
                  Skip
                </button>
              </BoardCard>
            ))}
            {(skipped.length > 0 || paused.length > 0) && (
              <div className="rounded-xl border border-dashed border-line px-3 py-2 text-xs">
                <button onClick={() => setFolded((f) => !f)} className="flex w-full items-center gap-1 text-left text-muted hover:text-ink">
                  <ChevronRight size={12} className={`transition-transform ${folded ? "" : "rotate-90"}`} /> Skipped or paused ({skipped.length + paused.length})
                </button>
                {!folded && (
                  <ul className="mt-1.5 space-y-1">
                    {[...paused, ...skipped].map(({ p, plan }) => (
                      <li key={p.url} className="flex items-center gap-1.5">
                        <button onClick={() => open(p.url)} className="min-w-0 flex-1 truncate text-left hover:text-accent" title={p.title}>
                          {p.title}
                        </button>
                        <span className="shrink-0 text-muted">{plan.why}</span>
                        {plan.state === "paused" && (
                          <button onClick={() => void pause(p, false)} className="shrink-0 text-accent hover:underline">
                            Resume
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Column>
          <Column title="Reviewed today" n={today.length} tone="" dot="bg-sky-500" empty="No reviews yet today.">
            {today.map(([url, t]) => {
              const l = label(url);
              const posted = t.lastPost && Date.parse(t.lastPost.at) >= Date.parse(t.lastRun!.at);
              const known = prs.some((x) => x.url === url);
              return (
                <BoardCard key={url} title={l.title} where={`${l.where} · ${new Date(t.lastRun!.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`} why={`${t.lastRun!.by === "autopilot" ? "Autopilot" : "You"} reviewed it · ${posted ? "posted" : "not posted"}`}>
                  {known && (
                    <button onClick={() => open(url)} className={btnS}>
                      Open
                    </button>
                  )}
                </BoardCard>
              );
            })}
          </Column>
        </div>
        <section className="mx-5 mb-6 rounded-2xl border border-line bg-panel px-4 py-3">
          <h2 className="mb-2 text-sm font-semibold">Activity</h2>
          {!auto.activity.length && <p className="text-xs text-muted">Nothing yet. Reviews you start and post show up here.</p>}
          <ul className="space-y-1">
            {auto.activity.slice(0, 40).map((a, i) => (
              <li key={`${a.at}-${i}`} className="flex items-start gap-2 text-xs">
                <span aria-hidden className="w-4 shrink-0 text-center">
                  {ACT_ICON[a.kind]}
                </span>
                <span className="min-w-0 flex-1">
                  {a.title && <span className="font-medium">{a.title} · </span>}
                  <span className="text-muted">{a.detail}</span>
                </span>
                <span className="shrink-0 text-muted">{ago(a.at)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

const btnS = "inline-flex items-center gap-1 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";

function Column({ title, n, tone, dot, box = "border-line bg-sunken/50", empty, children }: { title: string; n: number; tone: string; dot: string; box?: string; empty: string; children?: ReactNode }) {
  return (
    <section aria-label={title} className={`flex min-w-0 flex-col gap-2.5 rounded-2xl border p-3 ${box}`}>
      <h2 className={`flex items-center gap-1.5 px-1 text-sm font-semibold ${tone}`}>
        <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden />
        <span className="flex-1">{title}</span> <span className="rounded-full bg-panel px-1.5 text-xs font-normal text-muted">{n}</span>
      </h2>
      {children}
      {!n && <p className="px-1 text-xs leading-relaxed text-muted">{empty}</p>}
    </section>
  );
}

function BoardCard({ n, title, where, wf, why, risk, tone = "border-line bg-panel", children }: { n?: number; title: string; where: string; wf?: string; why: string; risk?: Risk | null; tone?: string; children?: ReactNode }) {
  return (
    <article className={`space-y-1.5 rounded-xl border px-3 py-2.5 ${tone}`}>
      <div className="flex items-start gap-2">
        {risk && (
          <span className="order-last mt-0.5">
            <RiskBadge risk={risk} always />
          </span>
        )}
        {n !== undefined && <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sunken text-[0.65rem] font-semibold">{n}</span>}
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-medium leading-snug">{title}</div>
          <div className="truncate text-[0.7rem] text-muted">
            {where}
            {wf ? ` · ${wf}` : ""}
          </div>
        </div>
      </div>
      <p className="text-xs">{why}</p>
      {children && <div className="flex flex-wrap gap-1.5 pt-0.5">{children}</div>}
    </article>
  );
}

// ── Settings: workflows, hand-off rules and limits ──

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
const commaList = (s: string) => s.split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);

export function RulesPage({ review, onMenu }: { review: Review; onMenu: () => void }) {
  const { auto, saveRules, prs, setRulesOpen } = review;
  const [draft, setDraft] = useState<AutopilotRules | null>(null);
  const [text, setText] = useState({ sensitive: "", include: "", exclude: "" });
  const [editing, setEditing] = useState<string | null>(null); // workflow id
  const [state, setState] = useState<{ busy?: boolean; saved?: boolean; error?: string }>({});
  const load = (r: AutopilotRules) => {
    setDraft(r);
    setText({ sensitive: r.sensitivePaths.join("\n"), include: r.repos.include.join("\n"), exclude: r.repos.exclude.join("\n") });
  };
  useEffect(() => {
    if (auto && !draft) load(auto.rules);
  }, [auto, draft]);
  const rules = useMemo<AutopilotRules | null>(
    () => draft && { ...draft, sensitivePaths: lines(text.sensitive), repos: { include: lines(text.include).map((s) => s.toLowerCase()), exclude: lines(text.exclude).map((s) => s.toLowerCase()) } },
    [draft, text],
  );
  // What these settings would do to today's PRs, before you save them: overall, and per workflow.
  const preview = useMemo(() => {
    if (!rules || !auto) return null;
    const n: Partial<Record<PlanState, number>> = {};
    const per: Record<string, { picks: number; handed: number }> = {};
    for (const p of prs) {
      const plan = planFor(p, { ...auto, rules });
      n[plan.state] = (n[plan.state] ?? 0) + 1;
      if (plan.workflow && plan.state !== "skip") {
        const w = (per[plan.workflow.id] ??= { picks: 0, handed: 0 });
        w.picks++;
        if (plan.state === "handoff") w.handed++;
      }
    }
    return { n, per };
  }, [rules, auto, prs]);
  const badRegex = rules?.sensitivePaths.filter((s) => {
    try {
      new RegExp(s);
      return false;
    } catch {
      return true;
    }
  });
  if (!rules || !draft) return <main className="flex flex-1 items-center justify-center text-sm text-muted">Loading settings…</main>;
  const set = (patch: Partial<AutopilotRules>) => {
    setDraft({ ...draft, ...patch });
    setState({});
  };
  const setWorkflows = (workflows: Workflow[]) => set({ workflows });
  const patchWf = (id: string, patch: Partial<Workflow>) => setWorkflows(draft.workflows.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const moveWf = (id: string, by: number) => {
    const i = draft.workflows.findIndex((w) => w.id === id);
    const j = i + by;
    if (i < 0 || j < 0 || j >= draft.workflows.length) return;
    const next = [...draft.workflows];
    [next[i], next[j]] = [next[j], next[i]];
    setWorkflows(next);
  };
  const addWf = () => {
    const id = `wf-${Date.now().toString(36)}`;
    setWorkflows([...draft.workflows, { id, name: "New workflow", enabled: false, lane: "needsYou", label: "ai-review", repos: [], depth: "standard", then: "draft", recheck: true }]);
    setEditing(id);
  };
  const removeWf = (id: string) => {
    setWorkflows(draft.workflows.filter((w) => w.id !== id));
    setEditing(null);
  };
  const save = async () => {
    setState({ busy: true });
    try {
      await saveRules(rules);
      setDraft(null); // reload from what the server kept
      setEditing(null);
      setState({ saved: true });
    } catch (e) {
      setState({ error: (e as Error).message });
    }
  };
  const changed = JSON.stringify(rules) !== JSON.stringify(auto?.rules);
  // The big on/off switch saves right away, like the board's Turn on / Pause; the rest waits for Save.
  const setEnabled = async (enabled: boolean) => {
    if (!auto) return;
    setState({ busy: true });
    try {
      await saveRules({ ...auto.rules, enabled });
      setDraft((d) => d && { ...d, enabled });
      setState({});
    } catch (e) {
      setState({ error: `Couldn't turn autopilot ${enabled ? "on" : "off"}: ${(e as Error).message}` });
    }
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-2.5">
        <MenuButton onClick={onMenu} />
        <button
          onClick={() => {
            if (changed && !window.confirm("You have unsaved Autopilot settings. Leave and discard them?")) return;
            setRulesOpen(false);
            review.setBoardOpen(true);
          }}
          className="inline-flex items-center gap-1 rounded-md bg-sunken px-2 py-1 text-xs hover:text-accent"
        >
          <ChevronLeft size={13} /> Back to Autopilot
        </button>
      </header>
      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-5xl space-y-5 px-6 py-5">
          <section className="flex items-center gap-4 rounded-2xl border border-line bg-panel px-5 py-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-700 dark:text-violet-300">
              <Bot size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-semibold">Autopilot settings</h1>
              <p className="text-sm text-muted">Which PRs it picks, how hard it looks, and what it does with what it finds. It never approves.</p>
            </div>
            <span className="text-xs text-muted">Autopilot is {draft.enabled ? "on" : "off"}</span>
            <Switch on={draft.enabled} onChange={(v) => void setEnabled(v)} label="Autopilot (saves right away)" big disabled={state.busy} />
          </section>
          <p className="-mt-2 px-1 text-xs text-muted">When it&apos;s on, it checks for PRs on your interval and reviews one at a time with read-only tools: it can&apos;t post, push or run anything itself. Only a workflow set to &quot;Post comments itself&quot; posts, and never an approval.</p>

          <div className="flex items-center">
            <h2 className="flex-1 text-base font-semibold">Workflows</h2>
            <button onClick={addWf} className="inline-flex items-center gap-1 rounded-lg border border-line bg-panel px-3 py-1 text-xs hover:border-accent hover:text-accent">
              <Plus size={12} /> New workflow
            </button>
          </div>
          <p className="-mt-3 text-xs text-muted">Checked top to bottom: when a PR fits more than one, the first one handles it.</p>
          <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
            {draft.workflows.map((w, i) => (
              <WorkflowCard
                key={w.id}
                w={w}
                first={i === 0}
                last={i === draft.workflows.length - 1}
                stats={preview?.per[w.id]}
                editing={editing === w.id}
                onEdit={(on) => setEditing(on ? w.id : null)}
                onChange={(patch) => patchWf(w.id, patch)}
                onMove={(by) => moveWf(w.id, by)}
                onRemove={() => removeWf(w.id)}
              />
            ))}
            {!draft.workflows.length && <p className="text-sm text-muted">No workflows: autopilot won&apos;t pick any PR. Add one to start.</p>}
          </div>

          <div className="grid gap-3.5 md:grid-cols-2">
            <Box title="Hand it to me when…" hint="Applies to every workflow. These PRs come to you instead.">
              <Field label="It touches these paths (regular expressions, one per line)">
                <textarea value={text.sensitive} onChange={(e) => setText({ ...text, sensitive: e.target.value })} rows={4} className={`${input} font-mono text-xs`} />
                {!!badRegex?.length && <span className="text-xs text-danger">Not valid, will be dropped: {badRegex.join(", ")}</span>}
              </Field>
              <Row label="More changed lines than">
                <input type="number" min={50} value={draft.maxChangedLines} onChange={(e) => set({ maxChangedLines: Number(e.target.value) })} className={`${field} w-24`} />
              </Row>
              <Row label="Risk score at or above (0 = off)">
                <input type="number" min={0} max={100} value={draft.riskHandoff} onChange={(e) => set({ riskHandoff: Number(e.target.value) })} className={`${field} w-24`} />
              </Row>
              <Row label="Skip PRs with this label">
                <input value={draft.skipLabel} onChange={(e) => set({ skipLabel: e.target.value })} className={`${field} w-40 font-mono text-xs`} />
              </Row>
              <Row label="Skip draft PRs">
                <Switch on={draft.skipDrafts} onChange={(v) => set({ skipDrafts: v })} label="Skip draft PRs" />
              </Row>
              <Field label="In my own words (Claude reads this)">
                <textarea value={draft.handoffNotes} onChange={(e) => set({ handoffNotes: e.target.value })} rows={2} className={input} placeholder="e.g. anything that changes the public API" />
              </Field>
            </Box>
            <Box title="Limits" hint="Reviews use your Claude plan, the same limit as your own chats.">
              <Row label="Look for PRs every (min)">
                <input type="number" min={5} max={240} value={draft.intervalMinutes} onChange={(e) => set({ intervalMinutes: Number(e.target.value) })} className={`${field} w-24`} />
              </Row>
              <Row label="Reviews at the same time (1–5)">
                <input type="number" min={1} max={5} value={draft.workers} onChange={(e) => set({ workers: Number(e.target.value) })} className={`${field} w-24`} />
              </Row>
              <Field label="Only these repos (owner/name, one per line; empty = all)">
                <textarea value={text.include} onChange={(e) => setText({ ...text, include: e.target.value })} rows={2} className={`${input} font-mono text-xs`} placeholder="vendasta/galaxy" />
              </Field>
              <Field label="Never these repos">
                <textarea value={text.exclude} onChange={(e) => setText({ ...text, exclude: e.target.value })} rows={2} className={`${input} font-mono text-xs`} />
              </Field>
            </Box>
            <Box title="GitHub labels" hint="Off by default: these change PRs on GitHub, from your account.">
              <Row label="Put a state label on PRs autopilot handles">
                <Switch on={draft.stateLabels.enabled} onChange={(v) => set({ stateLabels: { ...draft.stateLabels, enabled: v } })} label="State labels" />
              </Row>
              <Row label="After it reviews">
                <input value={draft.stateLabels.reviewed} onChange={(e) => set({ stateLabels: { ...draft.stateLabels, reviewed: e.target.value } })} disabled={!draft.stateLabels.enabled} className={`${field} w-40 font-mono text-xs disabled:opacity-50`} />
              </Row>
              <Row label="After it hands one to you">
                <input value={draft.stateLabels.handed} onChange={(e) => set({ stateLabels: { ...draft.stateLabels, handed: e.target.value } })} disabled={!draft.stateLabels.enabled} className={`${field} w-40 font-mono text-xs disabled:opacity-50`} />
              </Row>
              <p className="text-xs text-muted">A label missing in a repo is created there the first time. Each new state replaces the other. To skip a PR, use the skip label above; to ask for a review, use a workflow that starts on a label.</p>
            </Box>
            <Box title="Desktop alerts" hint="When Vlens isn't the window you're looking at. Vlens Settings → Notifications silences them all.">
              {(
                [
                  ["handed", "A PR is handed to me"],
                  ["ready", "A review is ready for me"],
                  ["posted", "Autopilot posted a review"],
                  ["failed", "A review failed"],
                ] as const
              ).map(([k, label]) => (
                <Row key={k} label={label}>
                  <Switch on={draft.alerts[k]} onChange={(v) => set({ alerts: { ...draft.alerts, [k]: v } })} label={label} />
                </Row>
              ))}
            </Box>
          </div>
        </div>
      </div>
      <footer className="flex flex-wrap items-center gap-3 border-t border-line px-6 py-2.5">
        {preview && (
          <span className="text-xs text-muted">
            With these settings: {preview.n.queued ?? 0} queued · {preview.n.handoff ?? 0} handed to you · {(preview.n.reviewed ?? 0) + (preview.n.posted ?? 0)} reviewed · {preview.n.skip ?? 0} skipped
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {state.error && <span className="text-xs text-danger">{state.error}</span>}
          {state.saved && !changed && <span className="text-xs text-success">Saved.</span>}
          <button onClick={() => load({ ...DEFAULT_RULES, enabled: draft.enabled })} className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent">
            <RotateCcw size={12} /> Defaults
          </button>
          <button onClick={() => void save()} disabled={state.busy || !changed} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-on-accent disabled:opacity-50">
            <Hand size={12} /> Save settings
          </button>
        </span>
      </footer>
    </main>
  );
}

function WorkflowCard({
  w,
  first,
  last,
  stats,
  editing,
  onEdit,
  onChange,
  onMove,
  onRemove,
}: {
  w: Workflow;
  first: boolean;
  last: boolean;
  stats?: { picks: number; handed: number };
  editing: boolean;
  onEdit: (on: boolean) => void;
  onChange: (patch: Partial<Workflow>) => void;
  onMove: (by: number) => void;
  onRemove: () => void;
}) {
  const [repos, setRepos] = useState(w.repos.join(", "));
  useEffect(() => {
    if (!editing) setRepos(w.repos.join(", "));
  }, [editing, w.repos]);
  return (
    <article className={`flex flex-col gap-3 rounded-2xl border px-4 py-3.5 ${editing ? "border-accent bg-panel" : w.enabled ? "border-line bg-panel" : "border-line bg-sunken/60"}`}>
      <div className="flex items-center gap-2">
        {editing ? (
          <input value={w.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Workflow name" className={`${input} font-semibold`} />
        ) : (
          <strong className="flex-1 text-sm">{w.name}</strong>
        )}
        <Switch on={w.enabled} onChange={(v) => onChange({ enabled: v })} label={w.name} />
      </div>
      {editing ? (
        <div className="space-y-2.5 text-xs">
          <Field label="When">
            <select value={w.lane} onChange={(e) => onChange({ lane: e.target.value as WorkflowLane })} className={input}>
              {Object.entries(LANE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          {w.lane === "label" && (
            <Field label="The label (add it to a PR on GitHub to ask for a review)">
              <input value={w.label} onChange={(e) => onChange({ label: e.target.value })} className={`${input} font-mono text-xs`} placeholder="ai-review" />
            </Field>
          )}
          <Field label="Only in these repos (owner/name, comma separated; empty = any)">
            <input
              value={repos}
              onChange={(e) => {
                setRepos(e.target.value);
                onChange({ repos: commaList(e.target.value) });
              }}
              className={`${input} font-mono text-xs`}
              placeholder="vendasta/vlens"
            />
          </Field>
          <Field label="Review">
            <select value={w.depth} onChange={(e) => onChange({ depth: e.target.value as Depth })} className={input}>
              {Object.entries(DEPTH_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Then">
            <select value={w.then} onChange={(e) => onChange({ then: e.target.value as WorkflowThen })} className={input}>
              {Object.entries(THEN_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {w.then === "comment" && <span className="text-amber-700 dark:text-amber-400">Posts from your GitHub account without asking you first. Still never approves.</span>}
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={w.recheck} onChange={(e) => onChange({ recheck: e.target.checked })} /> Review again on new pushes
          </label>
        </div>
      ) : (
        <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1.5 text-xs">
          <dt className="text-muted">When</dt>
          <dd>
            {LANE_LABEL[w.lane]}
            {w.lane === "label" && <span className="ml-1 rounded bg-sunken px-1 font-mono">{w.label}</span>}
            {w.repos.length ? <span className="text-muted"> · in {w.repos.map((r) => r.split("/")[1] ?? r).join(", ")}</span> : null}
          </dd>
          <dt className="text-muted">Review</dt>
          <dd>{DEPTH_LABEL[w.depth]}</dd>
          <dt className="text-muted">Then</dt>
          <dd className={w.then === "comment" ? "font-semibold text-amber-800 dark:text-amber-300" : w.then === "draft" ? "font-semibold" : ""}>{THEN_LABEL[w.then]}</dd>
          <dt className="text-muted">Re-check</dt>
          <dd>{w.recheck ? "On new pushes" : "No"}</dd>
        </dl>
      )}
      <div className="flex gap-2 border-t border-line pt-2 text-[0.7rem] text-muted">
        {w.enabled ? (
          <>
            <span>{stats?.picks ?? 0} {stats?.picks === 1 ? "PR" : "PRs"} right now</span>
            <span>·</span>
            <span>{stats?.handed ?? 0} handed to you</span>
          </>
        ) : (
          <span>Off</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onEdit(!editing)} className="flex-1 rounded-lg border border-line px-2 py-1 text-xs hover:border-accent hover:text-accent">
          {editing ? "Done" : "Edit workflow"}
        </button>
        <button onClick={() => onMove(-1)} disabled={first} aria-label={`Move ${w.name} up`} title="Move up (checked earlier)" className="rounded-lg border border-line p-1.5 hover:border-accent hover:text-accent disabled:opacity-30">
          <ArrowUp size={12} />
        </button>
        <button onClick={() => onMove(1)} disabled={last} aria-label={`Move ${w.name} down`} title="Move down" className="rounded-lg border border-line p-1.5 hover:border-accent hover:text-accent disabled:opacity-30">
          <ArrowDown size={12} />
        </button>
        {editing && (
          <button onClick={onRemove} aria-label={`Delete ${w.name}`} title="Delete" className="rounded-lg border border-line p-1.5 text-danger hover:border-danger">
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </article>
  );
}

function Switch({ on, onChange, label, big = false, disabled = false }: { on: boolean; onChange: (v: boolean) => void; label: string; big?: boolean; disabled?: boolean }) {
  return (
    <button
      role="switch"
      disabled={disabled}
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`flex shrink-0 items-center rounded-full p-0.5 transition ${big ? "h-6 w-11" : "h-[18px] w-8"} ${on ? "justify-end bg-accent" : "justify-start bg-line"} disabled:opacity-60`}
    >
      <span className={`rounded-full bg-white shadow-sm ${big ? "h-5 w-5" : "h-3.5 w-3.5"}`} />
    </button>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-3 border-t border-line pt-2 text-sm">
      <span className="min-w-0 flex-1">{label}</span>
      {children}
    </div>
  );
}

const field = "rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent";
const input = `w-full ${field}`;

function Box({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-panel px-4 py-3.5">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}
