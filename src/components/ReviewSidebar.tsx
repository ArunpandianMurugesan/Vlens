"use client";

import { Bot, Eye, GitPullRequest, Loader2, RefreshCw, Sparkles } from "lucide-react";
import type { Review } from "@/hooks/useReview";
import type { PrLane, PrSummary } from "@/lib/types";

// vTower's lanes (vendasta/vtower, renderer/app.js LANES), in its order.
export const LANES: Record<PrLane, { label: string; dot: string; text: string }> = {
  needsYou: { label: "Needs you", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  mine: { label: "Your PRs", dot: "bg-accent", text: "text-accent" },
  team: { label: "Needs your team", dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-400" },
  approvedWaiting: { label: "Approved · awaiting others", dot: "bg-violet-500", text: "text-violet-700 dark:text-violet-400" },
  waitingAuthor: { label: "Waiting on author", dot: "bg-muted", text: "text-muted" },
  done: { label: "Done · your part", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  fyi: { label: "FYI", dot: "bg-line", text: "text-muted" },
};

export const CI_DOT: Record<PrSummary["ci"], string> = {
  passing: "bg-emerald-500",
  failing: "bg-red-500",
  pending: "bg-amber-500 animate-pulse",
  none: "bg-transparent",
};

export function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 604800) return `${Math.round(s / 86400)}d`;
  return `${Math.round(s / 604800)}w`;
}

// Whose move is it? The sidebar's sections, from each PR's lane and reason.
export type Group = "yours" | "waiting" | "ready" | "radar";
export const GROUPS: { id: Group; label: string; tone: string }[] = [
  { id: "yours", label: "Your move", tone: "text-amber-700 dark:text-amber-400" },
  { id: "waiting", label: "Waiting on others", tone: "text-muted" },
  { id: "ready", label: "Ready to merge", tone: "text-emerald-700 dark:text-emerald-400" },
  { id: "radar", label: "On your radar", tone: "text-muted" },
];
export function groupOf(p: PrSummary): Group {
  if (p.lane === "needsYou") return "yours";
  if (p.lane === "mine") return p.priority === "high" ? "yours" : /ready to merge/.test(p.why) ? "ready" : "waiting";
  if (p.lane === "done") return "ready";
  if (p.lane === "approvedWaiting" || p.lane === "waitingAuthor") return "waiting";
  return "radar"; // team, fyi
}
// The inbox lists' sections: reviews you (or your team) owe, and your own PRs.
export type Section = { id: string; label: string; tone: string; head?: string; folded?: boolean; test: (p: PrSummary) => boolean };
export const SECTIONS: Record<"reviews" | "mine", Section[]> = {
  reviews: [
    { id: "needsYou", label: "Needs you", tone: "text-amber-700 dark:text-amber-400", test: (p) => p.lane === "needsYou" },
    { id: "team", label: "Needs your team", tone: "text-sky-700 dark:text-sky-400", test: (p) => p.lane === "team" && !p.isDraft && p.priority !== "stale" },
    { id: "approvedWaiting", label: "Approved · awaiting others", tone: "text-violet-700 dark:text-violet-400", test: (p) => p.lane === "approvedWaiting" },
    { id: "waitingAuthor", label: "Waiting on author", tone: "text-muted", head: "text-teal-700 dark:text-teal-400", test: (p) => p.lane === "waitingAuthor" },
    { id: "done", label: "Done · your part", tone: "text-emerald-700 dark:text-emerald-400", test: (p) => p.lane === "done" },
    { id: "teamDrafts", label: "Your team's drafts", tone: "text-muted", head: "text-violet-700 dark:text-violet-400", folded: true, test: (p) => p.lane === "team" && p.isDraft },
    { id: "teamQuiet", label: "Your team · quiet 30+ days", tone: "text-muted", head: "text-slate-500 dark:text-slate-400", folded: true, test: (p) => p.lane === "team" && !p.isDraft && p.priority === "stale" },
    { id: "fyi", label: "FYI", tone: "text-muted", head: "text-slate-500 dark:text-slate-400", folded: true, test: (p) => p.lane === "fyi" },
  ],
  // vTower's "Your PRs" lane, ranked: blocked on you, ready, awaiting review, stale.
  mine: [
    { id: "fix", label: "Blocked on you", tone: "text-red-700 dark:text-red-400", test: (p) => p.lane === "mine" && p.priority === "high" },
    { id: "ready", label: "Ready to merge", tone: "text-emerald-700 dark:text-emerald-400", test: (p) => p.lane === "mine" && p.priority === "normal" },
    { id: "awaiting", label: "Awaiting review", tone: "text-muted", head: "text-sky-700 dark:text-sky-400", test: (p) => p.lane === "mine" && p.priority === "low" && !p.isDraft },
    { id: "drafts", label: "Drafts", tone: "text-muted", head: "text-violet-700 dark:text-violet-400", test: (p) => p.lane === "mine" && p.isDraft },
    { id: "stale", label: "Stale (30+ days)", tone: "text-muted", head: "text-slate-500 dark:text-slate-400", folded: true, test: (p) => p.lane === "mine" && p.priority === "stale" },
  ],
};
export const RANK: Record<PrSummary["priority"], number> = { high: 0, normal: 1, low: 2, stale: 3 };
// vTower's approval meter: approvals out of the branch's required count, where it matters.
export function meter(p: PrSummary): string | null {
  const show = p.lane === "approvedWaiting" || p.lane === "done" || ((p.lane === "needsYou" || p.lane === "team") && p.approvals > 0) || (p.lane === "fyi" && p.why === "approved without you");
  if (!show) return null;
  return p.requiredApprovals ? `${Math.min(p.approvals, p.requiredApprovals)}/${p.requiredApprovals} ✓` : `${p.approvals} ✓`;
}
const teamName = (t: string) => t.split("/").pop() ?? t;

// The line under a PR's title: why it's in its section, plus CI when that's the news.
export function statusLine(p: PrSummary) {
  const bits = [p.why];
  if (p.ci === "pending" && !/CI/.test(p.why)) bits.push("checks running");
  if (p.ci === "failing" && !/CI/.test(p.why)) bits.push("CI failing");
  if (p.lane === "team" && p.teams?.length) bits[0] = `asked @${p.teams.map(teamName).join(", @")}`;
  else if (p.lane === "team" && p.pinged) bits[0] = "your team was tagged";
  else if (p.lane === "team" && p.squad) bits[0] = `from ${teamName(p.squad)}, awaiting review`;
  if (p.botApprovals && !p.approvals) bits.push("only a bot approved");
  if (p.lane !== "mine" && p.author) bits.push(`@${p.author}`);
  return bits.join(" · ");
}

// The Vlens Review left panel: where to go, not the lists themselves (those fill the
// main area, PrInbox.tsx). New, My PRs, Needs my review, then Autopilot and how its day
// is going.
export function ReviewSidebar({ review, onDone }: { review: Review; onDone: () => void }) {
  const { board, prs, loading, refresh, inbox, goInbox, news, auto, selected, boardOpen, rulesOpen, setBoardOpen, planOf } = review;
  const away = !!selected || boardOpen || rulesOpen; // a PR, the board or settings is open
  const count = {
    new: news.length,
    mine: prs.filter((p) => p.lane === "mine").length,
    // What's waiting on you: not drafts, not quiet ones (those are listed, folded).
    reviews: prs.filter((p) => p.lane === "needsYou" || (p.lane === "team" && !p.isDraft && p.priority !== "stale")).length,
  };
  const r = auto?.rules;
  const needsYou = auto ? prs.filter((p) => ["handoff"].includes(planOf(p)?.state ?? "") || auto.failed[p.url]?.headSha === p.headSha).length : 0;
  const nextIn = r?.enabled && auto?.lastCheck ? Math.max(0, Math.ceil((Date.parse(auto.lastCheck) + r.intervalMinutes * 60_000 - Date.now()) / 60_000)) : null;
  const items = [
    { id: "new", label: "New", Icon: Sparkles, hot: true },
    { id: "mine", label: "My PRs", Icon: GitPullRequest, hot: false },
    { id: "reviews", label: "Needs my review", Icon: Eye, hot: false },
  ] as const;
  return (
    <div className="flex min-h-0 flex-1 flex-col px-2.5">
      <div className="flex items-center gap-2 px-2 pb-2 text-[0.7rem] text-muted">
        <strong className="flex-1 text-[0.95rem] text-ink">PR Reviews</strong>
        <span title={board?.login ? `Signed in to GitHub as @${board.login}` : undefined}>
          {loading ? "Syncing…" : !board?.fetchedAt ? "" : Date.now() - Date.parse(board.fetchedAt) < 60_000 ? "Synced now" : `Synced ${ago(board.fetchedAt)} ago`}
        </span>
        <button onClick={() => void refresh()} disabled={loading} aria-label="Get the latest from GitHub" title="Get the latest from GitHub" className="rounded-md p-1 hover:bg-panel hover:text-ink disabled:opacity-60">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <nav aria-label="PR lists" className="space-y-0.5">
        {items.map(({ id, label, Icon, hot }) => {
          const on = inbox === id && !away;
          return (
            <button
              key={id}
              onClick={() => {
                goInbox(id);
                onDone();
              }}
              aria-current={on ? "page" : undefined}
              className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm ${on ? "bg-accent/15 font-semibold text-ink" : inbox === id ? "bg-panel/60 text-ink" : "text-ink/80 hover:bg-panel/60"}`}
            >
              <Icon size={15} className={on ? "text-accent" : "text-muted"} />
              <span className="flex-1">{label}</span>
              {count[id] > 0 && <span className={`min-w-[1.25rem] rounded-full px-1.5 text-center text-[0.7rem] ${hot ? "bg-amber-600 text-white" : "bg-line/70 text-muted"}`}>{count[id]}</span>}
            </button>
          );
        })}
      </nav>
      <div className="mx-1.5 my-3 h-px bg-line" />
      <button
        onClick={() => {
          setBoardOpen(true);
          onDone();
        }}
        aria-current={boardOpen && !rulesOpen ? "page" : undefined}
        className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm ${boardOpen || rulesOpen ? "bg-accent/15 font-semibold" : "text-ink/80 hover:bg-panel/60"}`}
      >
        <Bot size={15} className={boardOpen || rulesOpen ? "text-accent" : "text-muted"} />
        <span className="flex-1">Autopilot</span>
        {needsYou > 0 && <span className="rounded-full bg-red-500/15 px-1.5 text-[0.7rem] text-red-700 dark:text-red-300">{needsYou}</span>}
        <span className={`flex items-center gap-1 text-[0.7rem] ${r?.enabled ? "text-emerald-700 dark:text-emerald-400" : "text-muted"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${r?.enabled ? "bg-emerald-500" : "bg-muted"}`} aria-hidden /> {r?.enabled ? "On" : "Off"}
        </span>
      </button>
      <span className="flex-1" />
      {auto && r && (
        <div className="mx-1 mb-3 space-y-1.5 rounded-xl border border-line bg-panel px-3 py-2.5 text-xs">
          <strong className="block">Autopilot today</strong>
          {auto.running ? (
            <span className="flex items-center gap-1.5 text-sky-700 dark:text-sky-400">
              <Loader2 size={11} className="animate-spin" /> <span className="truncate">Reviewing {auto.running.title}</span>
            </span>
          ) : (
            <span className="text-muted">
              {auto.today} of {r.dailyCap} reviews · {!r.enabled ? "off" : nextIn === null ? `every ${r.intervalMinutes} min` : nextIn === 0 ? "checking soon" : `next check in ${nextIn} min`}
            </span>
          )}
          <div className="h-1.5 rounded-full bg-sunken">
            <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.min(100, (auto.today / r.dailyCap) * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}
