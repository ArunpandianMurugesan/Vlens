"use client";

import { ChevronRight, GitPullRequest, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Review } from "@/hooks/useReview";
import type { PrLane, PrSummary } from "@/lib/types";

export const LANES: Record<PrLane, { label: string; dot: string; text: string }> = {
  needsYou: { label: "Needs you", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
  mine: { label: "Yours", dot: "bg-accent", text: "text-accent" },
  team: { label: "Team", dot: "bg-sky-500", text: "text-sky-700 dark:text-sky-400" },
  waiting: { label: "Waiting", dot: "bg-muted", text: "text-muted" },
  done: { label: "Done", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
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
  if (p.lane === "mine") return /ready to merge/.test(p.why) ? "ready" : /waiting for review/.test(p.why) ? "waiting" : "yours";
  if (p.lane === "done") return "ready";
  if (p.lane === "waiting") return "waiting";
  return "radar"; // team, fyi
}
// The sidebar's two tabs: reviews you (or your team) owe, and your own PRs.
type Tab = "reviews" | "mine";
type Section = { id: string; label: string; tone: string; folded?: boolean; test: (p: PrSummary) => boolean };
const SECTIONS: Record<Tab, Section[]> = {
  reviews: [
    { id: "asked", label: "Asked of you", tone: "text-amber-700 dark:text-amber-400", test: (p) => p.lane === "needsYou" },
    { id: "team", label: "Asked of your team", tone: "text-sky-700 dark:text-sky-400", test: (p) => p.lane === "team" },
    { id: "reviewed", label: "You reviewed", tone: "text-muted", test: (p) => p.lane === "waiting" || p.lane === "done" },
    { id: "fyi", label: "Mentions and FYI", tone: "text-muted", folded: true, test: (p) => p.lane === "fyi" },
  ],
  mine: [
    { id: "fix", label: "Needs your fix", tone: "text-red-700 dark:text-red-400", test: (p) => p.lane === "mine" && /changes requested|CI failing|merge conflict/.test(p.why) },
    { id: "ready", label: "Ready to merge", tone: "text-emerald-700 dark:text-emerald-400", test: (p) => p.lane === "mine" && /ready to merge/.test(p.why) },
    { id: "waiting", label: "Waiting for review", tone: "text-muted", test: (p) => p.lane === "mine" && /waiting for review/.test(p.why) },
    { id: "drafts", label: "Drafts", tone: "text-muted", test: (p) => p.lane === "mine" && p.why === "draft" },
  ],
};
const tabOf = (p: PrSummary): Tab => (p.lane === "mine" ? "mine" : "reviews");
const teamName = (t: string) => t.split("/").pop() ?? t;

// The line under a PR's title: why it's in its section, plus CI when that's the news.
export function statusLine(p: PrSummary) {
  const bits = [p.why];
  if (p.ci === "pending" && !/CI/.test(p.why)) bits.push("checks running");
  if (p.ci === "failing" && !/CI/.test(p.why)) bits.push("CI failing");
  if (p.lane === "team" && p.teams?.length) bits[0] = `asked @${p.teams.map(teamName).join(", @")}`;
  if (p.lane !== "mine" && p.author) bits.push(`@${p.author}`);
  return bits.join(" · ");
}

// The Vlens Review side tab: your open PRs, by whose move it is.
export function ReviewSidebar({ review, onPick }: { review: Review; onPick: (url: string) => void }) {
  const { board, prs, loading, refresh, selected } = review;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({}); // folded sections opened
  const [tab, setTabState] = useState<Tab>(() => {
    try {
      return localStorage.getItem("lens.prTab") === "mine" ? "mine" : "reviews";
    } catch {
      return "reviews";
    }
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      localStorage.setItem("lens.prTab", t);
    } catch {}
  };
  // Opening a PR from elsewhere (search, a card) shows the tab it's in.
  const selectedPr = prs.find((p) => p.url === selected);
  useEffect(() => {
    if (selectedPr) setTabState(tabOf(selectedPr));
  }, [selectedPr?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = prs.filter((p) => !q || `${p.title} ${p.repo} #${p.number} ${p.author} ${(p.teams ?? []).join(" ")}`.toLowerCase().includes(q.toLowerCase()));
  const count = { reviews: shown.filter((p) => p.lane === "needsYou" || p.lane === "team").length, mine: shown.filter((p) => p.lane === "mine").length };
  const groups = useMemo(
    () => SECTIONS[tab].map((g) => ({ ...g, list: shown.filter(g.test).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) })),
    [shown, tab],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 px-3">
        <div className="flex items-center gap-2 text-[0.7rem] text-muted">
          <GitPullRequest size={12} />
          <span className="min-w-0 flex-1 truncate" title={board?.login ? `Signed in to GitHub as @${board.login}` : undefined}>
            {loading
              ? "Checking GitHub…"
              : !board?.fetchedAt
                ? "Not synced yet"
                : Date.now() - Date.parse(board.fetchedAt) < 60_000
                  ? "Synced just now"
                  : `Synced ${ago(board.fetchedAt)} ago`}
          </span>
          <button
            onClick={() => void refresh()}
            disabled={loading}
            aria-label="Get the latest from GitHub"
            className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-0.5 text-xs text-ink hover:border-accent hover:text-accent disabled:opacity-60"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm">
          <Search size={14} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PRs" className="w-full bg-transparent outline-none placeholder:text-muted" />
        </label>
        <div role="tablist" className="flex rounded-lg bg-sunken p-0.5 text-xs">
          {(
            [
              ["reviews", "Reviews"],
              ["mine", "My PRs"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 ${tab === id ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
              {label}
              {count[id] > 0 && <span className={`rounded-full px-1.5 text-[0.65rem] ${id === "reviews" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-line/60 text-muted"}`}>{count[id]}</span>}
            </button>
          ))}
        </div>
      </div>

      <nav className="mt-1 flex-1 overflow-y-auto px-2 pb-3 scroll-thin" aria-label="Your pull requests">
        {board?.error && <p className="m-1 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{board.error}</p>}
        {!board && <p className="px-3 py-4 text-center text-xs text-muted">Loading PRs from GitHub…</p>}
        {board && !groups.some((g) => g.list.length) && !board.error && (
          <p className="px-3 py-4 text-center text-xs text-muted">{q ? "No PRs match." : tab === "reviews" ? "No reviews waiting on you or your team." : "You have no open PRs."}</p>
        )}
        {groups.map((g) => {
          if (!g.list.length) return null;
          const folded = !!g.folded && !open[g.id] && !q;
          return (
            <div key={g.id} className="pt-2">
              <button
                onClick={() => g.folded && setOpen((o) => ({ ...o, [g.id]: !o[g.id] }))}
                className={`flex w-full items-center gap-1.5 px-2 pb-1 text-left text-[0.75rem] font-bold ${g.tone === "text-muted" ? "text-ink/85" : g.tone} ${g.folded ? "hover:text-ink" : "cursor-default"}`}
              >
                {g.folded && <ChevronRight size={12} className={`transition-transform ${folded ? "" : "rotate-90"}`} />}
                {g.label}
                <span className="font-normal text-muted">{g.list.length}</span>
              </button>
              {!folded && (
                <div className="space-y-1">
                  {g.list.map((p) => (
                    <button
                      key={p.url}
                      onClick={() => onPick(p.url)}
                      aria-current={p.url === selected}
                      className={`flex w-full flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition ${p.url === selected ? "border-accent/40 bg-panel shadow-sm" : "border-transparent hover:bg-panel/60"}`}
                    >
                      <span className="line-clamp-2 w-full text-sm font-medium leading-snug">{p.title}</span>
                      <span className="flex w-full items-center gap-1.5 text-[0.7rem]">
                        <span className="shrink-0 text-muted">
                          {p.repo.split("/")[1]} #{p.number}
                        </span>
                        <span className={`min-w-0 flex-1 truncate ${g.tone}`}>{statusLine(p)}</span>
                        {p.ci !== "none" && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CI_DOT[p.ci]}`} title={`CI ${p.ci}`} />}
                        <span className="shrink-0 text-muted">{ago(p.updatedAt)}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
