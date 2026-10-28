"use client";

import { ChevronRight, GitPullRequest, RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
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
const LANE_ORDER: PrLane[] = ["needsYou", "mine", "team", "waiting", "done", "fyi"];

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

type Filter = "all" | "needsYou" | "mine";

// The Lens Review side tab: your open PRs, grouped by repo.
export function ReviewSidebar({ review, onPick }: { review: Review; onPick: (url: string) => void }) {
  const { board, prs, loading, refresh, selected } = review;
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [opened, setOpened] = useState<Set<string>>(new Set()); // repos start collapsed

  const shown = prs.filter(
    (p) =>
      (filter === "all" || p.lane === filter) &&
      (!q || `${p.title} ${p.repo} #${p.number} ${p.author}`.toLowerCase().includes(q.toLowerCase())),
  );
  // Repos that need you float to the top; inside a repo, most urgent lane first, then newest.
  const repos = useMemo(() => {
    const m = new Map<string, PrSummary[]>();
    for (const p of shown) m.set(p.repo, [...(m.get(p.repo) ?? []), p]);
    const rank = (p: PrSummary) => LANE_ORDER.indexOf(p.lane);
    return [...m.entries()]
      .map(([repo, list]) => ({ repo, list: list.sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt)) }))
      .sort((a, b) => rank(a.list[0]) - rank(b.list[0]) || b.list.length - a.list.length || a.repo.localeCompare(b.repo));
  }, [shown]);

  const count = (f: Filter) => (f === "all" ? prs.length : prs.filter((p) => p.lane === f).length);

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
            className="inline-flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-0.5 text-xs text-ink hover:border-accent hover:text-accent disabled:opacity-60"
          >
            <RefreshCw size={11} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>
        <div className="flex rounded-lg bg-panel p-0.5 text-xs">
          {(["all", "needsYou", "mine"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 rounded-md py-1 transition ${filter === f ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink"}`}
            >
              {f === "all" ? "All" : f === "needsYou" ? "Needs you" : "Mine"} {count(f)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm">
          <Search size={14} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search PRs" className="w-full bg-transparent outline-none placeholder:text-muted" />
        </label>
      </div>

      <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-3 scroll-thin">
        {board?.error && <p className="m-1 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{board.error}</p>}
        {!board && <p className="px-3 py-4 text-center text-xs text-muted">Loading PRs from GitHub…</p>}
        {board && !repos.length && !board.error && (
          <p className="px-3 py-4 text-center text-xs text-muted">{q || filter !== "all" ? "No PRs match." : "No open PRs need you. Nice."}</p>
        )}
        {repos.map(({ repo, list }) => {
          const open = opened.has(repo) || !!q; // a search shows its matches
          return (
            <div key={repo} className="mb-1">
              <button
                onClick={() => setOpened((c) => (c.has(repo) ? new Set([...c].filter((r) => r !== repo)) : new Set(c).add(repo)))}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-muted hover:text-ink"
                title={repo}
              >
                <ChevronRight size={13} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
                <span className="truncate font-medium text-ink">{repo.split("/")[1]}</span>
                <span className="truncate opacity-70">{repo.split("/")[0]}</span>
                <span className="ml-auto shrink-0 rounded-full bg-panel px-1.5">{list.length}</span>
              </button>
              {open && (
                <div className="space-y-0.5 pl-2">
                  {list.map((p) => (
                    <button
                      key={p.url}
                      onClick={() => onPick(p.url)}
                      className={`w-full rounded-lg px-2.5 py-2 text-left transition ${p.url === selected ? "bg-panel shadow-sm" : "hover:bg-panel/60"}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LANES[p.lane].dot}`} title={LANES[p.lane].label} />
                        <span className="line-clamp-2 text-sm leading-snug">{p.title}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 pl-4 text-[0.7rem] text-muted">
                        <span className={`shrink-0 whitespace-nowrap ${LANES[p.lane].text}`}>{LANES[p.lane].label}</span>
                        <span>·</span>
                        <span className="shrink-0">#{p.number}</span>
                        {p.lane !== "mine" && <span className="truncate">@{p.author}</span>}
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          {p.ci !== "none" && <span className={`h-1.5 w-1.5 rounded-full ${CI_DOT[p.ci]}`} title={`CI ${p.ci}`} />}
                          {ago(p.updatedAt)}
                        </span>
                      </div>
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
