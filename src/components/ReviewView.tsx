"use client";

import {
  Check,
  ExternalLink,
  GitBranch,
  GitMerge,
  GitPullRequest,
  Loader2,
  RefreshCw,
  Sparkles,
  Wrench,
  ImageIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Review } from "@/hooks/useReview";
import type { TreeChat } from "@/hooks/useTreeChat";
import { addPrSession, usePrSessions } from "@/lib/prSessions";
import type { Risk } from "@/lib/risk";
import type { PrSummary } from "@/lib/types";
import { ago, groupOf } from "./ReviewSidebar";
import { ReviewResults } from "./ReviewResults";
import { AutopilotBoard, RulesPage } from "./Autopilot";
import { isPrTab, PR_TABS, PrPage, TabNavLabel, usePrExtras } from "./PrPage";
import { MenuButton } from "./Sidebar";

// What Claude is asked to do. Reviews post nothing (you post from the results panel,
// ReviewResults.tsx); addressing your own PR may edit files.
const RESULT_JSON = [
  "End your reply with the result as one ```json block, exactly this shape:",
  '{"verdict": "COMMENT | REQUEST_CHANGES", "summary": "two or three plain sentences for the review\'s top comment", "findings": [{"id": "1", "file": "path/in/repo.ts", "line": 42, "severity": "blocker | should | question | nit", "body": "what is wrong, why it matters, a suggested fix"}], "priorChecks": [{"commentId": 123456, "file": "path/in/repo.ts", "line": 40, "author": "login", "status": "fixed | unfixed | unverified", "evidence": "what in the code now shows it"}]}',
  "`line` is a line in the PR's new version of the file, inside the diff. Write each body as a reviewer's comment, kind and specific.",
  "Severity: blocker = breaks something real; should = worth fixing before merge; question = you aren't sure, ask; nit = small polish. A blocker or should must name the concrete case that triggers it and what goes wrong; if you can't, make it a question.",
  "One finding per root cause. Never approve: the verdict is COMMENT or REQUEST_CHANGES.",
].join("\n");

// Earlier inline review comments, so a re-review checks them instead of repeating them.
function priorCommentsStep(p: PrSummary) {
  return [
    `First read the earlier inline review comments: \`gh api repos/${p.repo}/pulls/${p.number}/comments --paginate\`. For each top-level one (no in_reply_to_id) that asks for a change, check the current code and put it in "priorChecks": fixed (cite the code that fixes it), unfixed, or unverified (can't tell from the code). Use the comment's id as commentId.`,
    "Don't add a new finding that repeats an earlier comment; it is covered by priorChecks.",
  ].join("\n");
}

// The deterministic risk score goes in, and Claude may move it by up to 20 points.
function riskStep(risk: Risk) {
  const why = risk.factors.length ? risk.factors.map((f) => `${f.points > 0 ? "+" : ""}${f.points} ${f.why}`).join("; ") : "nothing stood out";
  return [
    `Vlens scored this PR's risk at ${risk.score}/100 from its file list and size (${why}).`,
    'In the JSON add "risk": {"adjust": <a whole number from -20 to 20>, "why": "one plain sentence"}. Move it up when the code is riskier than those signals show (data loss, security, money, concurrency, a hard-to-undo change), down when it is safer (well tested, behind a flag, trivial). Use 0 when they are about right.',
  ].join("\n");
}

export function reviewPrompt(p: PrSummary, hasClone: boolean, risk?: Risk) {
  return [
    `Review pull request #${p.number} in ${p.repo}: ${p.url}`,
    "",
    hasClone
      ? "Use the lens:review skill in its PR Studio mode: run Steps 1 to 7 on this repo (its `.claude/review.md` overlay applies), and post nothing. Never post, approve, comment or push on GitHub."
      : "Read it with the gh CLI (gh pr view, gh pr diff). Look for real bugs and risks first. Never post, approve, comment or push on GitHub.",
    "If the PR links a Jira ticket, check the change against its acceptance criteria and say which are met.",
    priorCommentsStep(p),
    ...(risk ? [riskStep(risk)] : []),
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

interface Props {
  review: Review;
  onMenu: () => void;
  chat: TreeChat;
  // The open session's chat (with its file and terminal panels), shown in a PR's session tab.
  renderChat: () => ReactNode;
  home: string;
}

// One of the PR's own tabs (PR_TABS), "new" (a session that's starting), or a session id.
type Tab = string;

export function ReviewView({ review, onMenu, chat, renderChat, home }: Props) {
  const { pr, detail, cloneFor, prs, refresh, loading } = review;
  // Each PR keeps its own tabs: the sessions its buttons started, carried on right here.
  const prSessions = usePrSessions(pr?.url);
  const extras = usePrExtras(pr?.url);
  const [tabOf, setTabOf] = useState<Record<string, Tab>>({});
  const [starting, setStarting] = useState<{ url: string; kind: string } | null>(null);
  const tab = (pr && tabOf[pr.url]) || "summary";
  const setTab = (url: string, t: Tab) => setTabOf((all) => ({ ...all, [url]: t }));
  // Coming back to a session tab (from another PR, or after opening a session elsewhere): load it again.
  // Not the one just started, though: it's still streaming in as a draft until its first reply ends.
  const fresh = useRef<string | null>(null);
  useEffect(() => {
    if (isPrTab(tab) || tab === "new" || chat.activeId === tab) return;
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
        // A review: note which commit it reads, so Post can tell if the PR moves on.
        if (kind === "Review" || kind === "Self-review")
          void fetch("/api/review/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, sessionId: id, title: pr.title }) }).catch(() => {});
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
        void Promise.all([refresh(), extras.reload()]).finally(() => setLoadingDetail(false));
      }}
      disabled={refreshing}
      title="Get the latest from GitHub"
      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-60"
    >
      <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} /> Refresh
    </button>
  );
  const [merging, setMerging] = useState<{ method: "squash" | "merge" | "rebase"; busy: boolean; error: string | null } | null>(null);
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
  }, [pr?.url]);

  if (review.rulesOpen) return <RulesPage review={review} onMenu={onMenu} />;
  if (review.boardOpen) return <AutopilotBoard review={review} onMenu={onMenu} />;
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
  const mine = pr.lane === "mine";
  const d = detail?.url === pr.url ? detail : null;
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

  const compact = !isPrTab(tab);
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* On a session tab the header shrinks to one line: the review and chat need the room. */}
      <header className={`flex gap-3 border-b border-line ${compact ? "items-center px-4 py-2" : "items-start px-5 py-3.5"}`}>
        <MenuButton onClick={onMenu} className={compact ? "" : "mt-1"} />
        <div className="min-w-0 flex-1">
          <h1 className={compact ? "truncate text-sm font-semibold" : "text-lg font-semibold leading-snug"} title={compact ? pr.title : undefined}>
            {pr.title}
            {compact && <span className="ml-2 font-normal text-muted">{pr.repo.split("/")[1]} #{pr.number}</span>}
          </h1>
          <div className={`mt-0.5 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted ${compact ? "hidden" : "flex"}`}>
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
              <button onClick={() => start("Self-review", reviewPrompt(pr, !!clone, review.riskOf(pr)), "default", clone ?? home)} disabled={busy} title={busy ? busyHint : undefined} className={secondaryBtn}>
                <Sparkles size={14} /> Review with Claude
              </button>
              {beforeAfter}
              <button onClick={() => setMerging({ method: "squash", busy: false, error: null })} disabled={!!mergeBlock} title={mergeBlock ?? "Merge it on GitHub"} className={secondaryBtn}>
                <GitMerge size={14} /> Merge
              </button>
            </>
          ) : (
            <>
              <button onClick={() => start("Review", reviewPrompt(pr, !!clone, review.riskOf(pr)), "default", clone ?? home)} disabled={busy} title={busy ? busyHint : undefined} className={primaryBtn}>
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

      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line px-3 py-1.5 scroll-thin" aria-label="This PR">
        {PR_TABS.map((t) => (
          <TabButton key={t} on={tab === t} onClick={() => setTab(pr.url, t)}>
            <TabNavLabel tab={t} extras={extras} detail={d?.data} />
          </TabButton>
        ))}
        {(prSessions.length > 0 || starting?.url === pr.url) && <span className="mx-1 h-4 w-px shrink-0 bg-line" aria-hidden />}
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

      {isPrTab(tab) ? (
        <PrPage
          tab={tab}
          pr={pr}
          review={review}
          detail={d}
          extras={extras}
          sessions={prSessions}
          clone={clone}
          home={home}
          busy={busy}
          onTab={(t) => setTab(pr.url, t)}
          onReview={() => (mine ? start("Self-review", reviewPrompt(pr, !!clone, review.riskOf(pr)), "default", clone ?? home) : start("Review", reviewPrompt(pr, !!clone, review.riskOf(pr)), "default", clone ?? home))}
          onAsk={(kind, prompt) => start(kind, prompt, "default", clone ?? home)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {chat.session?.id === tab && <ReviewResults pr={pr} sessionId={tab} messages={chat.session.messages} />}
          <div className="flex min-h-0 flex-1">{renderChat()}</div>
        </div>
      )}
    </main>
  );
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
