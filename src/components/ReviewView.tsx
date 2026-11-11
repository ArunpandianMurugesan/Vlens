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
  GitMerge,
  GitPullRequest,
  Loader2,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Wrench,
  X,
  ImageIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Review } from "@/hooks/useReview";
import type { TreeChat } from "@/hooks/useTreeChat";
import { addPrSession, usePrSessions } from "@/lib/prSessions";
import type { PrSummary } from "@/lib/types";
import { Markdown } from "./Markdown";
import { ago, GROUPS, groupOf } from "./ReviewSidebar";
import { ReviewResults } from "./ReviewResults";
import { MenuButton } from "./Sidebar";

// What Claude is asked to do. Reviews post nothing (you post from the results panel,
// ReviewResults.tsx); addressing your own PR may edit files.
const RESULT_JSON = [
  "End your reply with the result as one ```json block, exactly this shape:",
  '{"verdict": "COMMENT | REQUEST_CHANGES | APPROVE", "summary": "two or three plain sentences for the review\'s top comment", "findings": [{"id": "1", "file": "path/in/repo.ts", "line": 42, "body": "what is wrong, why it matters, a suggested fix", "severity": "high | medium | low"}]}',
  "`line` is a line in the PR's new version of the file, inside the diff. Write each body as a reviewer's comment, kind and specific.",
].join("\n");

export function reviewPrompt(p: PrSummary, hasClone: boolean) {
  return [
    `Review pull request #${p.number} in ${p.repo}: ${p.url}`,
    "",
    hasClone
      ? "Use the lens:review skill in its PR Studio mode: run Steps 1 to 7 on this repo (its `.claude/review.md` overlay applies), and post nothing. Never post, approve, comment or push on GitHub."
      : "Read it with the gh CLI (gh pr view, gh pr diff). Look for real bugs and risks first. Never post, approve, comment or push on GitHub.",
    "If the PR links a Jira ticket, check the change against its acceptance criteria and say which are met.",
    "",
    RESULT_JSON,
  ].join("\n");
}

// galaxy's own skill (.claude/skills/galaxy-before-after in your clone): screenshots of
// what the PR changes, from the builds Cloud Build already published.
export function beforeAfterPrompt(p: PrSummary) {
  return [
    `Use the galaxy-before-after skill to show what pull request #${p.number} changes on screen: ${p.url}`,
    "Pick the apps and routes from its changed files as the skill says. Save every screenshot as a PNG file under ~/galaxy-proof. Never post anything on GitHub.",
    "",
    "End your reply with one ```json block, exactly this shape (absolute file paths):",
    '{"verdict": "PASS | INCONCLUSIVE | BLOCKED", "summary": "what changed on screen, in two sentences", "shots": [{"label": "Business Center · /route · desktop light", "before": "/Users/.../before.png", "after": "/Users/.../after.png"}]}',
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
  chat: TreeChat;
  // The open session's chat (with its file and terminal panels), shown in a PR's session tab.
  renderChat: () => ReactNode;
  home: string;
}

// "overview" (the PR itself), "new" (a session that's starting), or a session id.
type Tab = string;

export function ReviewView({ review, onMenu, chat, renderChat, home }: Props) {
  const { pr, detail, cloneFor, dismiss, prs, refresh, loading } = review;
  // Each PR keeps its own tabs: the sessions its buttons started, carried on right here.
  const prSessions = usePrSessions(pr?.url);
  const [tabOf, setTabOf] = useState<Record<string, Tab>>({});
  const [starting, setStarting] = useState<{ url: string; kind: string } | null>(null);
  const tab = (pr && tabOf[pr.url]) || "overview";
  const setTab = (url: string, t: Tab) => setTabOf((all) => ({ ...all, [url]: t }));
  // Coming back to a session tab (from another PR, or after opening a session elsewhere): load it again.
  // Not the one just started, though: it's still streaming in as a draft until its first reply ends.
  const fresh = useRef<string | null>(null);
  useEffect(() => {
    if (tab === "overview" || tab === "new" || chat.activeId === tab) return;
    if (tab === fresh.current && !chat.activeId && chat.rootPending) return;
    chat.selectSession(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the tab changes
  }, [tab, pr?.url]);
  const busy = !!chat.rootPending || !!starting;
  const start = (kind: string, prompt: string, mode: "default" | "plan" | "acceptEdits", cwd: string) => {
    if (!pr || busy) return;
    const url = pr.url;
    setStarting({ url, kind });
    setTab(url, "new");
    void chat
      .sendRoot(prompt, mode, undefined, [], cwd, (id) => {
        fresh.current = id;
        addPrSession(url, { id, kind, at: Date.now() });
        setTabOf((all) => (all[url] === "new" ? { ...all, [url]: id } : all));
        setStarting(null);
      })
      .finally(() => setStarting((s) => (s?.url === url ? null : s)));
  };
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
  const [merging, setMerging] = useState<{ method: "squash" | "merge" | "rebase"; busy: boolean; error: string | null } | null>(null);
  const [allFiles, setAllFiles] = useState(false);
  // Nothing picked yet: open the first PR whose move is yours (else the first one).
  const picked = useRef(false);
  useEffect(() => {
    if (picked.current || pr || !prs.length) return;
    picked.current = true;
    const first = prs.find((p) => groupOf(p) === "yours") ?? prs[0];
    void review.select(first.url);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the list first loads
  }, [prs.length, pr]);
  // A new PR: start fresh.
  useEffect(() => {
    setMerging(null);
    setAllFiles(false);
  }, [pr?.url]);

  if (!pr) {
    const needs = prs.filter((p) => groupOf(p) === "yours").length;
    return (
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <MenuButton onClick={onMenu} />
          <h1 className="flex-1 font-medium">Vlens Review</h1>
          {refreshBtn}
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <GitPullRequest size={28} className="text-accent" />
          <div className="text-xl font-semibold">{needs ? `${needs} PR${needs === 1 ? "" : "s"} wait${needs === 1 ? "s" : ""} on you` : "Your pull requests"}</div>
          <p className="max-w-md text-sm text-muted">Pick a PR on the left. You can have Claude review it in its repo, or fix the feedback on your own PRs.</p>
        </div>
      </main>
    );
  }

  const clone = cloneFor(pr);
  const primaryBtn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
  const secondaryBtn = "inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:border-accent hover:text-accent disabled:opacity-50";
  // galaxy PRs: screenshots of the change, with galaxy's own skill, in your clone.
  const beforeAfter =
    pr.repo.toLowerCase() === "vendasta/galaxy" ? (
      <button
        onClick={() => clone && start("Before/after", beforeAfterPrompt(pr), "default", clone)}
        disabled={!clone || busy}
        title={clone ? (busy ? busyHint : "Screenshots of what this PR changes, before and after, from its published build") : "Clone galaxy on your Mac first: the skill lives in the repo."}
        className={secondaryBtn}
      >
        <ImageIcon size={14} /> Before/after
      </button>
    ) : null;
  const group = GROUPS.find((g) => g.id === groupOf(pr))!;
  const mine = pr.lane === "mine";
  const d = detail?.url === pr.url ? detail : null;
  const shortPath = (p: string) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  const need = pr.requiredApprovals;
  const approved = pr.reviewDecision === "APPROVED" || (pr.reviewDecision === null && pr.approvals > 0);
  const mergeBlock = !mine
    ? "Only your own PRs merge from here."
    : pr.isDraft
      ? "It's a draft."
      : !approved
        ? "It isn't approved yet."
        : pr.ci === "failing"
          ? "CI is failing."
          : pr.mergeable === "CONFLICTING"
            ? "It has merge conflicts."
            : null;
  const doMerge = async () => {
    if (!merging) return;
    setMerging({ ...merging, busy: true, error: null });
    const r = await fetch("/api/review/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: pr.url, method: merging.method }) })
      .then((x) => x.json())
      .catch(() => ({ error: "Couldn't reach Vlens." }));
    if (r.error) setMerging({ ...merging, busy: false, error: r.error });
    else {
      setMerging(null);
      void refresh();
    }
  };
  const files = d?.data?.files ?? [];
  const changes = d?.data?.reviews.filter((r) => r.state === "CHANGES_REQUESTED").length ?? 0;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-start gap-3 border-b border-line px-5 py-3.5">
        <MenuButton onClick={onMenu} className="mt-1" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-snug">{pr.title}</h1>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <a href={pr.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
              {pr.repo.split("/")[1]} #{pr.number}
            </a>
            {!mine && <span>@{pr.author}</span>}
            <span className="flex items-center gap-1 font-mono">
              <GitBranch size={11} /> {pr.head} → {pr.base}
            </span>
            <span>
              <span className="text-emerald-600">+{pr.additions}</span> <span className="text-red-500">−{pr.deletions}</span>
            </span>
            <span>updated {ago(pr.updatedAt)} ago</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {mine ? (
            <>
              <button onClick={() => clone && start("Address feedback", addressPrompt(pr), "acceptEdits", clone)} disabled={!clone || busy} title={clone ? (busy ? busyHint : undefined) : "Clone this repo on your Mac first, so Claude can work on the branch."} className={primaryBtn}>
                <Wrench size={14} /> Address feedback
              </button>
              <button onClick={() => start("Self-review", reviewPrompt(pr, !!clone), "default", clone ?? home)} disabled={busy} title={busy ? busyHint : undefined} className={secondaryBtn}>
                <Sparkles size={14} /> Review with Claude
              </button>
              {beforeAfter}
              <button onClick={() => setMerging({ method: "squash", busy: false, error: null })} disabled={!!mergeBlock} title={mergeBlock ?? "Merge it on GitHub"} className={secondaryBtn}>
                <GitMerge size={14} /> Merge
              </button>
            </>
          ) : (
            <>
              <button onClick={() => start("Review", reviewPrompt(pr, !!clone), "default", clone ?? home)} disabled={busy} title={busy ? busyHint : undefined} className={primaryBtn}>
                <Sparkles size={14} /> Review with Claude
              </button>
              {beforeAfter}
            </>
          )}
          <a href={pr.url} target="_blank" rel="noreferrer" title="Open on GitHub" aria-label="Open on GitHub" className="rounded-lg border border-line p-2 text-muted hover:border-accent hover:text-accent">
            <ExternalLink size={14} />
          </a>
          {refreshBtn}
        </div>
      </header>

      {merging && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sunken/60 px-5 py-2 text-sm">
          <GitMerge size={14} className="text-accent" />
          <span>
            Merge {pr.repo.split("/")[1]} #{pr.number} into <span className="font-mono">{pr.base}</span>?
          </span>
          <select value={merging.method} onChange={(e) => setMerging({ ...merging, method: e.target.value as "squash" | "merge" | "rebase" })} className="rounded-lg border border-line bg-bg px-2 py-1 text-xs" aria-label="Merge method">
            <option value="squash">Squash and merge</option>
            <option value="merge">Merge commit</option>
            <option value="rebase">Rebase and merge</option>
          </select>
          <button onClick={() => void doMerge()} disabled={merging.busy} className={primaryBtn}>
            {merging.busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Merge
          </button>
          <button onClick={() => setMerging(null)} disabled={merging.busy} className="rounded-lg px-2 py-1 text-xs text-muted hover:text-ink">
            Cancel
          </button>
          {merging.error && <span className="w-full text-xs text-red-600">{merging.error}</span>}
        </div>
      )}

      {(prSessions.length > 0 || tab === "new") && (
        <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 py-1.5 scroll-thin" aria-label="This PR's sessions">
          <TabButton on={tab === "overview"} onClick={() => setTab(pr.url, "overview")}>
            <GitPullRequest size={12} /> Overview
          </TabButton>
          {prSessions.map((s) => (
            <TabButton key={s.id} on={tab === s.id} onClick={() => setTab(pr.url, s.id)} title={`Started ${ago(new Date(s.at).toISOString())} ago`}>
              <Sparkles size={12} /> {s.kind}
              <span className="text-muted">· {ago(new Date(s.at).toISOString())}</span>
            </TabButton>
          ))}
          {starting?.url === pr.url && (
            <TabButton on={tab === "new"} onClick={() => setTab(pr.url, "new")}>
              <Loader2 size={12} className="animate-spin" /> {starting.kind}
            </TabButton>
          )}
        </nav>
      )}

      {tab !== "overview" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {chat.session?.id === tab && <ReviewResults pr={pr} messages={chat.session.messages} />}
          <div className="flex min-h-0 flex-1">{renderChat()}</div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto max-w-5xl space-y-4 px-6 py-5">
            <div className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm ${group.id === "yours" ? "bg-amber-500/10" : group.id === "ready" ? "bg-emerald-500/10" : "bg-sunken"}`}>
              <span className={`font-medium ${group.tone}`}>{group.label}:</span> {pr.why}
              {pr.isDraft && <span className="rounded bg-panel px-1.5 text-xs text-muted">draft</span>}
              {pr.labels.map((l) => (
                <span key={l} className="rounded bg-panel px-1.5 text-xs text-muted">
                  {l}
                </span>
              ))}
              <span className="flex-1" />
              {confirmHide ? (
                <span className="flex items-center gap-1.5 text-xs text-muted">
                  Hide this PR from Vlens Review?
                  <button onClick={() => dismiss(pr.url)} className="rounded-md border border-line px-2 py-0.5 hover:text-ink">
                    Hide
                  </button>
                  <button onClick={() => setConfirmHide(false)} className="rounded-md px-1" aria-label="Cancel">
                    <X size={12} />
                  </button>
                </span>
              ) : (
                <button onClick={() => setConfirmHide(true)} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
                  <EyeOff size={12} /> Hide
                </button>
              )}
            </div>

            {!d?.data && !d?.error && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Loader2 size={14} className="animate-spin" /> Loading details…
              </div>
            )}
            {d?.error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{d.error}</p>}
            {d?.data && (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <Card title="Checks" note={pr.mergeable === "CONFLICTING" ? <span className="text-red-500">has conflicts</span> : pr.mergeable === "MERGEABLE" ? "no conflicts" : "checking conflicts"}>
                    {d.data.checks.length ? (
                      <ul className="space-y-1.5">
                        {d.data.checks.map((c, i) => (
                          <li key={i} className="flex items-center gap-2 text-sm">
                            <CheckMark state={c.state} />
                            <span className="min-w-0 flex-1 truncate">{c.name}</span>
                            <span className={`text-xs ${checkTone(c.state) === "bg-red-500" ? "text-red-500" : "text-muted"}`}>{checkWord(c.state)}</span>
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
                  </Card>

                  <Card
                    title="Reviews"
                    note={
                      <>
                        {pr.approvals}
                        {need ? ` of ${need}` : ""} approval{pr.approvals === 1 && !need ? "" : "s"}
                        {changes > 0 && <span className="text-amber-600"> · changes requested</span>}
                      </>
                    }
                  >
                    {d.data.reviews.length ? (
                      <ul className="space-y-3">
                        {d.data.reviews.map((r, i) => (
                          <li key={i} className="text-sm">
                            <div className="flex items-center gap-1.5">
                              {r.state === "APPROVED" ? <Check size={13} className="text-emerald-500" /> : r.state === "CHANGES_REQUESTED" ? <CircleDot size={13} className="text-amber-600" /> : <MessageSquare size={13} className="text-muted" />}
                              <span className="font-medium">@{r.author}</span>
                              <span className={r.state === "CHANGES_REQUESTED" ? "text-amber-700 dark:text-amber-400" : "text-muted"}>{REVIEW_STATE[r.state] ?? r.state.toLowerCase()}</span>
                              {r.at && <span className="ml-auto text-xs text-muted">{ago(r.at)} ago</span>}
                            </div>
                            {r.body.trim() && (
                              <div className="mt-1 line-clamp-4 border-l-2 border-line pl-3 text-muted">
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
                  </Card>
                </div>

                <Card title="Files changed" note={`${files.length} file${files.length === 1 ? "" : "s"}`}>
                  <ul className="space-y-1">
                    {(allFiles ? files : files.slice(0, 12)).map((f) => (
                      <li key={f.path} className="flex items-center gap-2 font-mono text-xs">
                        <FileCode size={12} className="shrink-0 text-muted" />
                        <span className="min-w-0 flex-1 truncate" title={f.path}>
                          {f.path}
                        </span>
                        {f.additions > 0 && <span className="text-emerald-600">+{f.additions}</span>}
                        {f.deletions > 0 && <span className="text-red-500">−{f.deletions}</span>}
                      </li>
                    ))}
                  </ul>
                  {files.length > 12 && (
                    <button onClick={() => setAllFiles((v) => !v)} className="mt-2 text-xs text-muted hover:text-accent">
                      {allFiles ? "Show fewer" : `Show all ${files.length}`}
                    </button>
                  )}
                </Card>

                <Card title="This PR's sessions">
                  <ul className="space-y-1.5">
                    {prSessions.map((s) => (
                      <li key={s.id} className="flex items-center gap-2 text-sm">
                        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{s.kind}</span>
                        <span className="text-xs text-muted">{ago(new Date(s.at).toISOString())} ago</span>
                        <button onClick={() => setTab(pr.url, s.id)} className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent hover:text-accent">
                          Open
                        </button>
                      </li>
                    ))}
                    {!prSessions.length && <li className="text-sm text-muted">None yet. Review with Claude starts one here.</li>}
                  </ul>
                  <p className="mt-2.5 flex items-center gap-1.5 text-xs text-muted">
                    <FolderGit2 size={12} />
                    {clone ? (
                      <>
                        Claude runs in your clone at <span className="font-mono">{shortPath(clone)}</span>.
                      </>
                    ) : (
                      <>No local clone of {pr.repo} found, so Claude reads the PR with gh from your home folder.</>
                    )}
                    {!mine && " Reviews are read-only; nothing is posted to GitHub."}
                  </p>
                </Card>

                <Fold title="Description">{d.data.body.trim() ? <Markdown text={d.data.body} /> : <p className="text-sm text-muted">No description.</p>}</Fold>
              </>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

function Card({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel px-4 py-3.5">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {note && <span className="ml-auto text-xs text-muted">{note}</span>}
      </div>
      {children}
    </section>
  );
}

function checkWord(state: string) {
  const t = checkTone(state);
  return t === "bg-emerald-500" ? (state === "SUCCESS" ? "Success" : state.toLowerCase()) : t === "bg-red-500" ? "Failure" : "Running";
}

function CheckMark({ state }: { state: string }) {
  const t = checkTone(state);
  if (t === "bg-emerald-500") return <Check size={13} className="shrink-0 text-emerald-600" aria-label="passed" />;
  if (t === "bg-red-500") return <X size={13} className="shrink-0 text-red-500" aria-label="failed" />;
  return <Loader2 size={13} className="shrink-0 animate-spin text-amber-500" aria-label="running" />;
}

const busyHint = "Claude is still starting the last one. Wait a moment.";

function TabButton({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${on ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink"}`}
    >
      {children}
    </button>
  );
}
