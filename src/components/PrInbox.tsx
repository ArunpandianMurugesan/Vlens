"use client";

import { Bot, Check, ChevronRight, FolderGit2, GitCommit, GitPullRequest, Loader2, MessageSquare, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { InboxTab, Review } from "@/hooks/useReview";
import { type Stage, stageOf } from "@/lib/lifecycle";
import type { News, NewsTone } from "@/lib/prSeen";
import type { PrSummary } from "@/lib/types";
import { RiskBadge } from "./RiskBadge";
import { ago, CI_DOT, meter, RANK, SECTIONS, statusLine } from "./ReviewSidebar";
import { MenuButton } from "./Sidebar";

// The PR lists, in the main area: New (what changed since you looked), My PRs (by whose
// move it is) and Needs my review (with where each review stands). Inside each list,
// PRs are nested by author, then repo (My PRs: by repo, they're all yours).

const META: Record<InboxTab, [string, string]> = {
  new: ["New", "What changed on your PRs and reviews since you last looked"],
  mine: ["My PRs", "PRs you opened, by whose move it is"],
  reviews: ["Needs my review", "PRs waiting on you or your team, and where each review stands"],
};

export const TONE: Record<NewsTone | "gray", { chip: string; tile: string; card: string }> = {
  orange: { chip: "bg-amber-500/15 text-amber-800 dark:text-amber-300", tile: "bg-amber-500/15 text-amber-700 dark:text-amber-300", card: "border-amber-500/40 bg-amber-500/5" },
  red: { chip: "bg-red-500/10 text-red-700 dark:text-red-300", tile: "bg-red-500/10 text-red-700 dark:text-red-300", card: "border-line bg-panel" },
  green: { chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", tile: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400", card: "border-line bg-panel" },
  violet: { chip: "bg-violet-500/10 text-violet-700 dark:text-violet-300", tile: "bg-violet-500/10 text-violet-700 dark:text-violet-300", card: "border-line bg-panel" },
  blue: { chip: "bg-sky-500/10 text-sky-700 dark:text-sky-300", tile: "bg-sky-500/10 text-sky-700 dark:text-sky-300", card: "border-line bg-panel" },
  gray: { chip: "bg-sunken text-muted", tile: "bg-sunken text-muted", card: "border-line bg-panel" },
};

type Tile = "ai" | "ci" | "ok" | "commits" | "talk" | "new" | "person" | "running";
type Row = { p: PrSummary; tone: NewsTone | "gray"; chip: string; detail: string; tile: Tile; auto?: boolean };

// Where the PR's review stands (lifecycle.ts), as the row's chip and line. null: nothing to say.
const STAGE_ROW: Record<Exclude<Stage, "none">, { tone: Row["tone"]; tile: Tile }> = {
  running: { tone: "blue", tile: "running" },
  failed: { tone: "red", tile: "ai" },
  draft: { tone: "orange", tile: "ai" },
  posted: { tone: "green", tile: "ai" },
  newCommits: { tone: "violet", tile: "commits" },
};
function stageRow(p: PrSummary, review: Review): Omit<Row, "p"> | null {
  const s = stageOf(p, review.life);
  if (s.stage === "none") return null;
  return { ...STAGE_ROW[s.stage], chip: s.chip, detail: s.detail, auto: s.auto };
}

function mineRow(p: PrSummary): Omit<Row, "p"> {
  if (p.isDraft) return { tone: "gray", chip: "Draft", detail: statusLine(p), tile: "person" };
  if (p.ci === "failing") return { tone: "red", chip: "Fix CI", detail: statusLine(p), tile: "ci" };
  if (p.priority === "high") return { tone: "orange", chip: "Your move", detail: statusLine(p), tile: "talk" };
  if (p.priority === "normal") return { tone: "green", chip: "Ready to merge", detail: statusLine(p), tile: "ok" };
  if (p.priority === "stale") return { tone: "gray", chip: "Stale", detail: statusLine(p), tile: "person" };
  return { tone: "gray", chip: "Waiting", detail: statusLine(p), tile: "person" };
}

const NEWS_TILE: Record<News["icon"], Tile> = { claude: "ai", ci: "ci", approved: "ok", commits: "commits", activity: "talk", new: "new" };

// Rows nested by author, then repo, each in the order its first (most urgent) row came.
type RepoGroup = { repo: string; rows: Row[] };
type AuthorGroup = { author: string; repos: RepoGroup[]; count: number };
function nest(rows: Row[]): AuthorGroup[] {
  const authors = new Map<string, Map<string, Row[]>>();
  for (const r of rows) {
    const repos = authors.get(r.p.author) ?? new Map<string, Row[]>();
    authors.set(r.p.author, repos);
    const list = repos.get(r.p.repo) ?? [];
    repos.set(r.p.repo, list);
    list.push(r);
  }
  return [...authors].map(([author, repos]) => ({ author, repos: [...repos].map(([repo, list]) => ({ repo, rows: list })), count: [...repos.values()].reduce((n, l) => n + l.length, 0) }));
}

export function PrInbox({ review, onMenu }: { review: Review; onMenu: () => void }) {
  const { inbox, prs, news, life, refresh, loading, board, markSeen } = review;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({}); // folded sections opened
  const [shut, setShut] = useState<Record<string, boolean>>({}); // author groups closed
  const match = (p: PrSummary) => !q || `${p.title} ${p.repo} #${p.number} ${p.author}`.toLowerCase().includes(q.toLowerCase());

  // Sections of rows; New has one.
  const groups = useMemo(() => {
    if (inbox === "new")
      return [
        {
          id: "new",
          label: "",
          folded: false,
          rows: news.filter((x) => match(x.p)).map(({ p, n }): Row => ({ p, tone: n.tone, chip: n.chip, detail: n.detail, tile: NEWS_TILE[n.icon], auto: n.icon === "claude" && life.tracks[p.url]?.lastRun?.by === "auto" })),
        },
      ];
    return SECTIONS[inbox].map((g) => ({
      id: g.id,
      label: g.label,
      folded: !!g.folded,
      rows: prs
        .filter((p) => g.test(p) && match(p))
        .sort((a, b) => RANK[a.priority] - RANK[b.priority] || b.updatedAt.localeCompare(a.updatedAt))
        .map((p): Row => {
          const s = stageRow(p, review);
          if (inbox === "mine") {
            // Your own PR: its status, unless a self-review is running, failed or waiting for you.
            const st = stageOf(p, review.life).stage;
            return { p, ...(s && (st === "running" || st === "draft" || st === "failed") ? s : mineRow(p)) };
          }
          return { p, ...(s ?? { tone: p.lane === "needsYou" ? "orange" : "gray", chip: g.label, detail: statusLine(p), tile: "person" }) };
        }),
    }));
  }, [inbox, news, prs, q, life]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const byAuthor = inbox !== "mine";

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
        <label className="flex h-8 w-60 items-center gap-1.5 rounded-lg bg-sunken px-2.5 text-sm text-muted focus-within:ring-2 focus-within:ring-accent/50">
          <Search size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by repo, title or author" aria-label="Filter by repo, title or author" className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted" />
        </label>
        <button onClick={() => void refresh()} disabled={loading} aria-label="Get the latest from GitHub" title="Get the latest from GitHub" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel text-muted hover:text-accent disabled:opacity-60">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-5xl space-y-2 px-6 py-5">
          {board?.error && <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">{board.error}</p>}
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
                {!folded &&
                  (byAuthor ? (
                    nest(g.rows).map((a) => {
                      const key = `${inbox}:${g.id}:${a.author}`;
                      const closed = !!shut[key] && !q;
                      return (
                        <div key={a.author} className="space-y-1.5">
                          <button onClick={() => setShut((s) => ({ ...s, [key]: !s[key] }))} aria-expanded={!closed} className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm hover:bg-sunken/60">
                            <ChevronRight size={13} className={`shrink-0 text-muted transition-transform ${closed ? "" : "rotate-90"}`} />
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-[0.6rem] font-semibold uppercase">{a.author.slice(0, 2) || "?"}</span>
                            <span className="font-medium">@{a.author || "unknown"}</span>
                            <span className="text-xs text-muted">{a.count}</span>
                          </button>
                          {!closed && (
                            <div className="ml-4 space-y-2 border-l border-line pl-4">
                              {a.repos.map((r) => (
                                <RepoBlock key={r.repo} group={r} review={review} />
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    nest(g.rows).flatMap((a) => a.repos).reduce<RepoGroup[]>((out, r) => {
                      // My PRs: every author is you, so only the repo level, merged across authors.
                      const hit = out.find((x) => x.repo === r.repo);
                      if (hit) hit.rows.push(...r.rows);
                      else out.push({ repo: r.repo, rows: [...r.rows] });
                      return out;
                    }, []).map((r) => <RepoBlock key={r.repo} group={r} review={review} />)
                  ))}
              </section>
            );
          })}
        </div>
      </div>
    </main>
  );
}

function RepoBlock({ group, review }: { group: RepoGroup; review: Review }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 px-1 text-xs text-muted" title={group.repo}>
        <FolderGit2 size={12} className="shrink-0" />
        <span className="truncate font-medium text-ink/80">{group.repo.split("/")[1] ?? group.repo}</span>
        <span className="truncate">{group.repo.split("/")[0]}</span>
        <span>· {group.rows.length}</span>
      </div>
      {group.rows.map((r) => (
        <PrRow key={r.p.url} r={r} risk={review.riskOf(r.p)} onOpen={() => void review.select(r.p.url)} />
      ))}
    </div>
  );
}

function PrRow({ r, risk, onOpen }: { r: Row; risk: ReturnType<Review["riskOf"]>; onOpen: () => void }) {
  const t = TONE[r.tone];
  const m = meter(r.p);
  return (
    <button onClick={onOpen} className={`flex w-full items-center gap-3.5 rounded-xl border px-3.5 py-3 text-left transition hover:border-accent/50 ${t.card}`}>
      <TileMark r={r} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 items-center gap-2">
          <strong className="truncate text-sm">{r.p.title}</strong>
          <span className="shrink-0 text-[0.7rem] text-muted">#{r.p.number}</span>
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

function TileMark({ r }: { r: Row }) {
  const base = "flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] text-[0.7rem] font-bold";
  if (r.tile === "running")
    return (
      <span className={`${base} ${TONE.blue.tile}`} title="Claude is reviewing">
        <Loader2 size={15} className="animate-spin" />
      </span>
    );
  // A review Claude did by itself (auto re-review) wears a bot; one you started, Claude's mark.
  if (r.tile === "ai")
    return (
      <span className={`${base} ${TONE.violet.tile}`} title={r.auto ? "Auto review" : "Claude"}>
        {r.auto ? <Bot size={15} /> : <Sparkles size={15} />}
      </span>
    );
  const Icon = { ci: X, ok: Check, commits: GitCommit, talk: MessageSquare, new: GitPullRequest, person: null }[r.tile];
  return <span className={`${base} ${TONE[r.tone].tile}`}>{Icon ? <Icon size={15} /> : r.p.author.slice(0, 2).toUpperCase()}</span>;
}
