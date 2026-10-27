"use client";

import {
  Check,
  ChevronRight,
  CircleDot,
  ExternalLink,
  EyeOff,
  FileCode,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  Loader2,
  Menu,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import type { Review } from "@/hooks/useReview";
import type { PrSummary } from "@/lib/types";
import { Markdown } from "./Markdown";
import { ago, CI_DOT, LANES } from "./ReviewSidebar";

// What Claude is asked to do. Reviews run read-only; addressing your own PR may edit files.
export function reviewPrompt(p: PrSummary, hasClone: boolean) {
  if (hasClone) return `/code-review ${p.number}`;
  return [
    `Review this pull request: ${p.url}`,
    "",
    "Read it with the gh CLI (gh pr view, gh pr diff). List real bugs and risks first, most serious first, with the file and line for each. Keep it short. Don't post anything to GitHub.",
  ].join("\n");
}

export function addressPrompt(p: PrSummary) {
  return [
    `This is my pull request: ${p.url}`,
    "",
    `Check out its branch with \`gh pr checkout ${p.number}\`, then read the review comments and any failing checks with gh. Make the fixes and tell me what you changed. Don't push, and don't reply on GitHub, without asking me first.`,
  ].join("\n");
}

const REVIEW_STATE: Record<string, string> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed",
};

function checkTone(state: string) {
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)) return "bg-emerald-500";
  if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(state)) return "bg-red-500";
  return "bg-amber-500";
}

function Stat({ label, children, tone }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel px-3 py-2">
      <div className="text-[0.65rem] uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-0.5 text-sm ${tone ?? ""}`}>{children}</div>
    </div>
  );
}

function Fold({ title, count, open: start = false, children }: { title: string; count?: number; open?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(start);
  return (
    <section className="rounded-2xl border border-line bg-panel">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium">
        <ChevronRight size={14} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        {title}
        {count !== undefined && <span className="rounded-full bg-sunken px-1.5 text-xs font-normal text-muted">{count}</span>}
      </button>
      {open && <div className="border-t border-line px-4 py-3">{children}</div>}
    </section>
  );
}

interface Props {
  review: Review;
  onMenu: () => void;
  onStart: (prompt: string, mode: "plan" | "acceptEdits", cwd: string) => void;
  home: string;
}

export function ReviewView({ review, onMenu, onStart, home }: Props) {
  const { pr, detail, cloneFor, dismiss, prs, refresh, loading } = review;
  const [loadingDetail, setLoadingDetail] = useState(false);
  const refreshing = loading || loadingDetail || (!!detail && !detail.data && !detail.error);
  const refreshBtn = (
    <button
      onClick={() => {
        setLoadingDetail(true);
        void refresh().finally(() => setLoadingDetail(false));
      }}
      disabled={refreshing}
      title="Get the latest from GitHub"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-60"
    >
      <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
    </button>
  );
  const [confirmHide, setConfirmHide] = useState(false);

  if (!pr) {
    const needs = prs.filter((p) => p.lane === "needsYou").length;
    return (
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <button onClick={onMenu} className="text-muted md:hidden" aria-label="Open sidebar">
            <Menu size={20} />
          </button>
          <h1 className="flex-1 font-medium">Lens Review</h1>
          {refreshBtn}
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <GitPullRequest size={28} className="text-accent" />
          <div className="text-xl font-semibold">{needs ? `${needs} PR${needs === 1 ? "" : "s"} need${needs === 1 ? "s" : ""} your review` : "Your pull requests"}</div>
          <p className="max-w-md text-sm text-muted">
            Pick a PR on the left. You can have Claude review it in its repo, or fix the feedback on your own PRs.
          </p>
        </div>
      </main>
    );
  }

  const clone = cloneFor(pr);
  const lane = LANES[pr.lane];
  const mine = pr.lane === "mine";
  const d = detail?.url === pr.url ? detail : null;
  const shortPath = (p: string) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  const need = pr.requiredApprovals;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-start gap-3 border-b border-line px-4 py-3">
        <button onClick={onMenu} className="mt-1 text-muted md:hidden" aria-label="Open sidebar">
          <Menu size={20} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-medium leading-snug">{pr.title}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <a href={pr.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
              {pr.repo} #{pr.number}
            </a>
            <span>@{pr.author}</span>
            <span className="flex items-center gap-1 font-mono">
              <GitBranch size={11} /> {pr.head} → {pr.base}
            </span>
            <span>updated {ago(pr.updatedAt)} ago</span>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border border-line px-2 py-0.5 text-xs ${lane.text}`}>{lane.label}</span>
        {refreshBtn}
      </header>

      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-5">
          <div className={`rounded-xl px-3 py-2 text-sm ${pr.lane === "needsYou" ? "bg-amber-500/10" : "bg-sunken"}`}>
            <span className={`font-medium ${lane.text}`}>{lane.label}:</span> {pr.why}
            {pr.isDraft && <span className="ml-2 rounded bg-panel px-1.5 text-xs text-muted">draft</span>}
            {pr.labels.map((l) => (
              <span key={l} className="ml-2 rounded bg-panel px-1.5 text-xs text-muted">{l}</span>
            ))}
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {!mine && (
              <button
                onClick={() => onStart(reviewPrompt(pr, !!clone), "plan", clone ?? home)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
              >
                <Sparkles size={14} /> Review with Claude
              </button>
            )}
            {mine && (
              <button
                onClick={() => clone && onStart(addressPrompt(pr), "acceptEdits", clone)}
                disabled={!clone}
                title={clone ? undefined : "Clone this repo on your Mac first, so Claude can work on the branch."}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                <Wrench size={14} /> Address feedback
              </button>
            )}
            {mine && (
              <button
                onClick={() => onStart(reviewPrompt(pr, !!clone), "plan", clone ?? home)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
              >
                <Sparkles size={14} /> Self-review
              </button>
            )}
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent"
            >
              <ExternalLink size={14} /> Open on GitHub
            </a>
            {confirmHide ? (
              <span className="flex items-center gap-1.5 text-xs text-muted">
                Hide this PR from Lens Review?
                <button onClick={() => dismiss(pr.url)} className="rounded-md border border-line px-2 py-1 hover:text-ink">Hide</button>
                <button onClick={() => setConfirmHide(false)} className="rounded-md px-1 py-1" aria-label="Cancel">
                  <X size={12} />
                </button>
              </span>
            ) : (
              <button onClick={() => setConfirmHide(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted hover:text-ink">
                <EyeOff size={14} /> Hide
              </button>
            )}
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <FolderGit2 size={12} />
            {clone ? (
              <>Claude runs in your clone at <span className="font-mono">{shortPath(clone)}</span>.</>
            ) : (
              <>No local clone of {pr.repo} found, so Claude reads the PR with gh from your home folder.</>
            )}
            {!mine && " Reviews are read-only and nothing is posted to GitHub."}
          </p>

          {/* Status */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Approvals" tone={pr.reviewDecision === "APPROVED" ? "text-emerald-600" : undefined}>
              {pr.approvals}
              {need ? ` of ${need}` : ""}
              {pr.reviewDecision === "CHANGES_REQUESTED" && <span className="ml-1 text-xs text-red-500">changes requested</span>}
            </Stat>
            <Stat label="CI">
              <span className="flex items-center gap-1.5">
                {pr.ci !== "none" && <span className={`h-2 w-2 rounded-full ${CI_DOT[pr.ci]}`} />}
                {pr.ci === "none" ? "no checks" : pr.ci}
              </span>
            </Stat>
            <Stat label="Merge" tone={pr.mergeable === "CONFLICTING" ? "text-red-500" : undefined}>
              {pr.mergeable === "MERGEABLE" ? "no conflicts" : pr.mergeable === "CONFLICTING" ? "has conflicts" : "checking"}
            </Stat>
            <Stat label="Changes">
              <span className="text-emerald-600">+{pr.additions}</span> <span className="text-red-500">−{pr.deletions}</span>
              <span className="ml-1 text-xs text-muted">{pr.changedFiles} files</span>
            </Stat>
          </div>

          {!d?.data && !d?.error && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={14} className="animate-spin" /> Loading details…
            </div>
          )}
          {d?.error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{d.error}</p>}
          {d?.data && (
            <>
              <section className="rounded-2xl border border-line bg-panel px-4 py-3">
                {d.data.body.trim() ? <Markdown text={d.data.body} /> : <p className="text-sm text-muted">No description.</p>}
              </section>

              <Fold title="Checks" count={d.data.checks.length} open={pr.ci === "failing"}>
                {d.data.checks.length ? (
                  <ul className="space-y-1">
                    {d.data.checks.map((c, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${checkTone(c.state)}`} />
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        <span className="text-xs lowercase text-muted">{c.state.replace(/_/g, " ")}</span>
                        {c.url && (
                          <a href={c.url} target="_blank" rel="noreferrer" className="text-muted hover:text-accent" aria-label={`Open ${c.name}`}>
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No checks on this PR.</p>
                )}
              </Fold>

              <Fold title="Reviews" count={d.data.reviews.length} open={mine && d.data.reviews.length > 0}>
                {d.data.reviews.length ? (
                  <ul className="space-y-3">
                    {d.data.reviews.map((r, i) => (
                      <li key={i} className="text-sm">
                        <div className="flex items-center gap-1.5">
                          {r.state === "APPROVED" ? <Check size={13} className="text-emerald-500" /> : r.state === "CHANGES_REQUESTED" ? <CircleDot size={13} className="text-red-500" /> : <MessageSquare size={13} className="text-muted" />}
                          <span className="font-medium">@{r.author}</span>
                          <span className="text-muted">{REVIEW_STATE[r.state] ?? r.state.toLowerCase()}</span>
                          {r.at && <span className="ml-auto text-xs text-muted">{ago(r.at)} ago</span>}
                        </div>
                        {r.body.trim() && (
                          <div className="mt-1 border-l-2 border-line pl-3 text-muted">
                            <Markdown text={r.body} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">No reviews yet.</p>
                )}
                {d.data.comments > 0 && <p className="mt-3 text-xs text-muted">Plus {d.data.comments} comment{d.data.comments === 1 ? "" : "s"} on GitHub.</p>}
              </Fold>

              <Fold title="Files changed" count={d.data.files.length}>
                <ul className="space-y-1">
                  {d.data.files.map((f) => (
                    <li key={f.path} className="flex items-center gap-2 font-mono text-xs">
                      <FileCode size={12} className="shrink-0 text-muted" />
                      <span className="min-w-0 flex-1 truncate" title={f.path}>{f.path}</span>
                      <span className="text-emerald-600">+{f.additions}</span>
                      <span className="text-red-500">−{f.deletions}</span>
                    </li>
                  ))}
                </ul>
              </Fold>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
