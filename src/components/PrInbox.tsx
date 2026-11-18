"use client";

import { Bot, Check, ChevronRight, EyeOff, GitCommit, GitPullRequest, MessageSquare, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { InboxTab, Review } from "@/hooks/useReview";
import type { Plan } from "@/lib/autopilotPlan";
import type { News, NewsTone } from "@/lib/prSeen";
import type { PrSummary } from "@/lib/types";
import { RiskBadge } from "./RiskBadge";
import { ago, CI_DOT, meter, RANK, SECTIONS, statusLine } from "./ReviewSidebar";
import { MenuButton } from "./Sidebar";

// The PR lists, in the main area: New (what changed since you looked), My PRs (by whose
// move it is) and Needs my review (with what autopilot did on each). One card per PR.

const META: Record<InboxTab, [string, string]> = {
  new: ["New", "What changed on your PRs and reviews since you last looked"],
  mine: ["My PRs", "PRs you opened, by whose move it is"],
  reviews: ["Needs my review", "PRs waiting on you or your team, with what Autopilot did on each"],
};

export const TONE: Record<NewsTone | "gray", { chip: string; tile: string; card: string }> = {
  orange: { chip: "bg-amber-500/15 text-amber-800 dark:text-amber-300", tile: "bg-amber-500/15 text-amber-700 dark:text-amber-300", card: "border-amber-500/40 bg-amber-500/5" },
  red: { chip: "bg-red-500/10 text-red-700 dark:text-red-300", tile: "bg-red-500/10 text-red-700 dark:text-red-300", card: "border-line bg-panel" },
  green: { chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", tile: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", card: "border-line bg-panel" },
  violet: { chip: "bg-violet-500/10 text-violet-700 dark:text-violet-300", tile: "bg-violet-500/10 text-violet-700 dark:text-violet-300", card: "border-line bg-panel" },
  blue: { chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300", tile: "bg-sky-500/10 text-sky-700 dark:text-sky-300", card: "border-line bg-panel" },
  gray: { chip: "bg-sunken text-muted", tile: "bg-sunken text-muted", card: "border-line bg-panel" },
};

type Row = { p: PrSummary; tone: NewsTone | "gray"; chip: string; detail: string; tile: "ai" | "ci" | "ok" | "commits" | "talk" | "new" | "person"; by?: string };

// What autopilot did on a PR, as the row's chip and line. null: nothing to say.
function autopilotRow(p: PrSummary, plan: Plan | null, by: string | undefined, enabled: boolean): Omit<Row, "p"> | null {
  if (!plan) return null;
  switch (plan.state) {
    case "reviewed":
      return { tone: "orange", chip: by === "autopilot" ? "Draft ready" : "Reviewed", detail: by === "autopilot" ? `Autopilot ${plan.why}. Nothing is posted until you say so.` : `Claude ${plan.why}`, tile: "ai", by };
    case "handoff":
      return { tone: "orange", chip: "Handed to you", detail: `Autopilot handed it to you: ${plan.why}`, tile: "ai", by: "autopilot" };
    case "changed":
      return { tone: "blue", chip: "New changes", detail: `Reviewed before · ${plan.why}`, tile: "ai", by };
    case "posted":
      return { tone: "green", chip: "Posted", detail: `Claude's ${plan.why}`, tile: "ai", by };
    case "queued":
      return enabled ? { tone: "violet", chip: "Queued", detail: `In the queue · ${plan.workflow?.name ?? "autopilot"} picks it on a coming check`, tile: "ai", by: "autopilot" } : null;
    case "paused":
      return { tone: "gray", chip: "Paused", detail: "You paused autopilot for this PR", tile: "person" };
    default:
      return null;
  }
}

function mineRow(p: PrSummary): Omit<Row, "p"> {
  if (p.isDraft) return { tone: "gray", chip: "Draft", detail: statusLine(p), tile: "person" };
  if (p.ci === "failing") return { tone: "red", chip: "Fix CI", detail: statusLine(p), tile: "ci" };
  if (p.priority === "high") return { tone: "orange", chip: "Your move", detail: statusLine(p), tile: "talk" };
  if (p.priority === "normal") return { tone: "green", chip: "Ready to merge", detail: statusLine(p), tile: "ok" };
  if (p.priority === "stale") return { tone: "gray", chip: "Stale", detail: statusLine(p), tile: "person" };
  return { tone: "gray", chip: "Waiting", detail: statusLine(p), tile: "person" };
}

const NEWS_TILE: Record<News["icon"], Row["tile"]> = { claude: "ai", ci: "ci", approved: "ok", commits: "commits", activity: "talk", new: "new" };

export function PrInbox({ review, onMenu }: { review: Review; onMenu: () => void }) {
  const { inbox, prs, news, planOf, auto, select, refresh, loading, board, markSeen, hidden, unhide } = review;
  const [q, setQ] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const match = (p: PrSummary) => !q || `${p.title} ${p.repo} #${p.number} ${p.author}`.toLowerCase().includes(q.toLowerCase());
  const enabled = !!auto?.rules.enabled;

  // Sections of rows; New has one.
  const groups = useMemo(() => {
    if (inbox === "new") return [{ id: "new", label: "", folded: false, rows: news.filter((x) => match(x.p)).map(({ p, n }): Row => ({ p, tone: n.tone, chip: n.chip, detail: n.detail, tile: NEWS_TILE[n.icon], by: auto?.tracks[p.url]?.lastRun?.by })) }];
    return SECTIONS[inbox].map((g) => ({
      id: g.id,
      label: g.label,
      folded: !!g.folded,
      rows: prs
        .filter((p) => g.test(p) && match(p))
        .sort((a, b) => RANK[a.priority] - RANK[b.priority] || b.updatedAt.localeCompare(a.updatedAt))
        .map((p): Row => {
          if (inbox === "mine") return { p, ...mineRow(p) };
          const by = auto?.tracks[p.url]?.lastRun?.by;
          const a = autopilotRow(p, planOf(p), by, enabled);
          return { p, by, ...(a ?? { tone: p.lane === "needsYou" ? "orange" : "gray", chip: g.label, detail: statusLine(p), tile: "person" }) };
        }),
    }));
  }, [inbox, news, prs, q, planOf, auto, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-6 py-3">
        <MenuButton onClick={onMenu} />
        <div className="min-w-0 flex-1">
          <h1 className="text-[0.95rem] font-semibold">{META[inbox][0]}</h1>
          <p className="truncate text-xs text-muted">{META[inbox][1]}</p>
        </div>
        {inbox === "new" && news.length > 0 && (
          <button onClick={() => markSeen(news.map((x) => x.p))} className="text-xs text-muted hover:text-accent">
            Mark all seen
          </button>
        )}
        {hidden.length > 0 && (
          <button onClick={() => setShowHidden((v) => !v)} aria-expanded={showHidden} className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent">
            <EyeOff size={12} /> Hidden ({hidden.length})
          </button>
        )}
        <label className="flex h-8 w-60 items-center gap-1.5 rounded-lg bg-sunken px-2.5 text-sm text-muted focus-within:ring-2 focus-within:ring-accent/50">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by repo or title" aria-label="Filter by repo or title" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
        </label>
        <button onClick={() => void refresh()} disabled={loading} aria-label="Get the latest from GitHub" title="Get the latest from GitHub" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel text-muted hover:text-accent disabled:opacity-60">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-5xl space-y-2 px-6 py-5">
          {board?.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{board.error}</p>}
          {showHidden && hidden.length > 0 && (
            <section aria-label="Hidden PRs" className="space-y-1 rounded-xl border border-dashed border-line px-3.5 py-2.5 text-sm">
              <div className="text-xs font-semibold text-muted">Hidden from PR Review ({hidden.length})</div>
              {hidden.map((p) => (
                <div key={p.url} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={p.title}>
                    {p.title} <span className="text-xs text-muted">{p.repo.split("/")[1]} #{p.number}</span>
                  </span>
                  <button onClick={() => unhide(p.url)} className="shrink-0 rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent hover:text-accent">
                    Unhide
                  </button>
                </div>
              ))}
            </section>
          )}
          {!board && <p className="py-8 text-center text-sm text-muted">Loading PRs from GitHub…</p>}
          {board && !total && !board.error && (
            <p className="py-10 text-center text-sm text-muted">
              {q ? "No PRs match." : inbox === "new" ? "You're caught up. Changes on your PRs and reviews show up here." : inbox === "mine" ? "You have no open PRs." : "No reviews waiting on you or your team."}
            </p>
          )}
          {groups.map((g) => {
            if (!g.rows.length) return null;
            const folded = g.folded && !open[g.id] && !q;
            return (
              <section key={g.id} className="space-y-2">
                {g.label && (
                  <button onClick={() => g.folded && setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))} className={`flex items-center gap-1.5 pt-2 text-xs font-semibold text-muted ${g.folded ? "hover:text-ink" : "cursor-default"}`}>
                    {g.folded && <ChevronRight size={12} className={`transition-transform ${folded ? "" : "rotate-90"}`} />}
                    {g.label} <span className="font-normal">{g.rows.length}</span>
                  </button>
                )}
                {!folded && g.rows.map((r) => <PrRow key={r.p.url} r={r} risk={review.riskOf(r.p)} onOpen={() => void select(r.p.url)} />)}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function PrRow({ r, risk, onOpen }: { r: Row; risk: ReturnType<Review["riskOf"]>; onOpen: () => void }) {
  const t = TONE[r.tone];
  const m = meter(r.p);
  return (
    <button onClick={onOpen} className={`flex w-full items-center gap-3.5 rounded-xl border px-3.5 py-3 text-left transition hover:border-accent/50 ${t.card}`}>
      <Tile r={r} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <strong className="truncate text-sm">{r.p.title}</strong>
          <span className="shrink-0 text-[0.7rem] text-muted">
            {r.p.repo.split("/")[1]} #{r.p.number}
          </span>
        </span>
        <span className="truncate text-xs text-muted">{r.detail}</span>
      </span>
      <RiskBadge risk={risk} />
      {m && <span className="shrink-0 rounded bg-sunken px-1 text-[0.65rem] text-muted">{m}</span>}
      {r.p.ci !== "none" && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CI_DOT[r.p.ci]}`} title={`CI ${r.p.ci}`} />}
      <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold ${t.chip}`}>{r.chip}</span>
      <span className="w-9 shrink-0 text-right text-[0.7rem] text-muted">{ago(r.p.updatedAt)}</span>
    </button>
  );
}

function Tile({ r }: { r: Row }) {
  const base = "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[0.7rem] font-bold";
  const cls = `${base} ${TONE[r.tone].tile}`;
  const Icon = { ai: Bot, ci: X, ok: Check, commits: GitCommit, talk: MessageSquare, new: GitPullRequest, person: null }[r.tile];
  // Autopilot's own runs wear "AP"; drafts from a Review you clicked wear Claude's mark.
  if (r.tile === "ai")
    return r.by === "autopilot" ? (
      <span className={`${base} ${TONE.violet.tile}`} title="Autopilot">
        AP
      </span>
    ) : (
      <span className={`${base} ${TONE.violet.tile}`} title="Claude">
        <Sparkles size={15} />
      </span>
    );
  return <span className={cls}>{Icon ? <Icon size={15} /> : r.p.author.slice(0, 2).toUpperCase()}</span>;
}
