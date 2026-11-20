"use client";

import {
  Bot,
  Check,
  ChevronLeft,
  ExternalLink,
  GitBranch,
  GitMerge,
  Loader2,
  RefreshCw,
  Sparkles,
  Wrench,
  ImageIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Review } from "@/hooks/useReview";
import type { TreeChat } from "@/hooks/useTreeChat";
import { addPrSession, type PrSession, usePrSessions } from "@/lib/prSessions";
import { ago } from "./ReviewSidebar";
import { ReviewResults, resultOf } from "./ReviewResults";
import type { ReviewResult } from "@/lib/reviewResult";
import { PrInbox } from "./PrInbox";
import { isPrTab, PR_TABS, PrPage, TabNavLabel, usePrExtras } from "./PrPage";
import { addressPrompt, beforeAfterPrompt, reviewPrompt } from "@/lib/reviewPrompt";
import type { Depth } from "@/lib/reviewPrompt";
import { MenuButton } from "./Sidebar";

interface Props {
  review: Review;
  onMenu: () => void;
  chat: TreeChat;
  // The open session's chat (with its file and terminal panels), shown in a PR's session tab.
  // `compact`: this view already has the PR header, so the chat should hide its own.
  renderChat: (opts?: { compact?: boolean }) => ReactNode;
  home: string;
}

// One of the PR's own tabs (PR_TABS), "new" (a session that's starting), or a session id.
type Tab = string;

export function ReviewView({ review, onMenu, chat, renderChat, home }: Props) {
  const { pr, detail, cloneFor, refresh, loading } = review;
  // Each PR keeps its own tabs: the sessions its buttons started, carried on right here.
  const prSessions = usePrSessions(pr?.url);
  const extras = usePrExtras(pr?.url, pr?.headSha, pr ? review.life.tracks[pr.url]?.lastRun : null);
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
  // What the open session handed back: a review's comments go to Discussion; before/after shots show here.
  const sessionResult = useMemo(() => (chat.session && chat.session.id === tab ? resultOf(chat.session.messages) : null), [chat.session, tab]);
  // One session per PR and kind: the PR's newest session of each kind is its tab, and
  // clicking the same button again carries on in that session instead of opening another.
  const perKind = latestPerKind(prSessions);
  // Claude's reviews (yours, and the ones it ran by itself) share one tab: the one you're
  // on, else the latest. Each kind still keeps its own session to carry on in.
  const reviews = perKind.filter((s) => REVIEW_KINDS.has(s.kind));
  const shownReview = reviews.find((s) => s.id === tab) ?? reviews.at(-1);
  const tabs = perKind.filter((s) => !REVIEW_KINDS.has(s.kind) || s === shownReview);
  // Sessions with a reply on its way from here (a second prompt would run Claude twice on one session).
  const inFlight = useRef(new Set<string>());
  // A prompt waiting for its session to open in the chat before it's sent.
  const [follow, setFollow] = useState<{ url: string; id: string; kind: string; prompt: string; mode: "default" | "plan" | "acceptEdits" | "auto"; title: string } | null>(null);
  const noteReview = (url: string, id: string, kind: string, title: string) => {
    // A review: note which commit it reads, so Post can tell if the PR moves on.
    if (kind === "Review" || kind === "Self-review")
      void fetch("/api/review/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, sessionId: id, title }) }).catch(() => {});
  };
  useEffect(() => {
    if (!follow || chat.session?.id !== follow.id) return;
    const f = follow;
    setFollow(null);
    if (chat.rootPending || inFlight.current.has(f.id)) return; // it's already working: just show it
    inFlight.current.add(f.id);
    noteReview(f.url, f.id, f.kind, f.title);
    void chat.sendRoot(f.prompt, f.mode).finally(() => {
      inFlight.current.delete(f.id);
      void extras.reload(); // its findings show in Summary and Discussion as drafts
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the session opens
  }, [follow, chat.session?.id]);
  const start = (kind: string, prompt: string, mode: "default" | "plan" | "acceptEdits" | "auto", cwd: string) => {
    if (!pr || busy) return;
    const url = pr.url;
    const existing = perKind.find((s) => s.kind === kind);
    if (existing) {
      addPrSession(url, { ...existing, at: Date.now() }); // now its latest: it's the one the review tab shows
      setTab(url, existing.id);
      if (!inFlight.current.has(existing.id)) setFollow({ url, id: existing.id, kind, prompt, mode, title: pr.title });
      return;
    }
    setStarting({ url, kind });
    setTab(url, "new");
    let started: string | null = null;
    void chat
      .sendRoot(prompt, mode, undefined, [], cwd, (id) => {
        fresh.current = id;
        started = id;
        inFlight.current.add(id);
        addPrSession(url, { id, kind, at: Date.now() });
        noteReview(url, id, kind, pr.title);
        setTabOf((all) => (all[url] === "new" ? { ...all, [url]: id } : all));
        setStarting(null);
      })
      .finally(() => {
        if (started) inFlight.current.delete(started);
        setStarting((s) => (s?.url === url ? null : s));
        void extras.reload(); // its findings show in Summary and Discussion as drafts
      });
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
  const [depth, setDepth] = useState<Depth>("standard"); // Review with Claude's depth
  const [merging, setMerging] = useState<{ method: "squash" | "merge" | "rebase"; busy: boolean; error: string | null } | null>(null);
  // A PR you just merged: it drops off the lists on the next refresh, so say so here.
  const [merged, setMerged] = useState<{ url: string; label: string } | null>(null);
  // A new PR: start fresh.
  useEffect(() => {
    setMerging(null);
    if (pr?.url) setMerged((m) => (m && m.url !== pr.url ? null : m));
  }, [pr?.url]);

  const mergedLine = merged && (
    <div role="status" className="flex flex-wrap items-center gap-2 border-b border-line bg-success/10 px-5 py-2 text-sm text-success">
      <Check size={14} /> Merged ✓ <span className="min-w-0 truncate text-ink">{merged.label}</span>
      <a href={merged.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline hover:text-accent">
        Open on GitHub <ExternalLink size={12} />
      </a>
      <button onClick={() => setMerged(null)} className="ml-auto text-xs text-muted hover:text-ink">
        Dismiss
      </button>
    </div>
  );
  if (!pr)
    return mergedLine ? (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {mergedLine}
        <PrInbox review={review} onMenu={onMenu} />
      </div>
    ) : (
      <PrInbox review={review} onMenu={onMenu} />
    );

  const clone = cloneFor(pr);
  const primaryBtn = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-on-accent disabled:opacity-50";
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
      setMerged({ url: pr.url, label: `${pr.repo}#${pr.number} into ${pr.base}` });
      void refresh();
    }
  };

  const compact = !isPrTab(tab);
  const listName = { new: "New", mine: "My PRs", reviews: "Needs my review" }[review.inbox];
  // Reviewed before at an older commit: a follow-up review (the earlier findings and only
  // the new commits), so review → fix → review converges instead of finding new nits.
  const take = extras.take;
  const followUp = take && pr.headSha && take.headSha !== pr.headSha ? { sha: take.headSha, earlier: take.result.findings } : undefined;
  const reviewNow = async () => {
    const useSkill = await fetch("/api/review-skill")
      .then((r) => r.json())
      .then((d: { useSkill?: boolean }) => !!d.useSkill, () => false);
    // Auto mode: a review only reads (the PR, the code, git and gh), so Claude's safety check
    // approves those steps and you aren't asked about each command. Risky ones still ask.
    start(mine ? "Self-review" : "Review", reviewPrompt(pr, !!clone, review.riskOf(pr), depth, useSkill, followUp), "auto", clone ?? home);
  };
  const reviewBtn = (
    <span className="inline-flex shrink-0 overflow-hidden rounded-lg">
      <button
        onClick={reviewNow}
        disabled={busy || !extras.takeLoaded}
        title={busy ? busyHint : followUp ? `Follow-up review: checks the earlier findings (at ${followUp.sha.slice(0, 7)}) and only the new commits. Nothing is posted.` : `Review with Claude, ${depth} depth. Nothing is posted.`}
        className={`${mine ? `border ${followUp ? "" : "border-r-0"} border-line hover:text-accent` : "bg-accent text-on-accent"} inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium disabled:opacity-50`}
      >
        <Sparkles size={14} /> {followUp ? "Follow-up review" : "Review with Claude"}
      </button>
      {!followUp && (
      <select
        value={depth}
        onChange={(e) => setDepth(e.target.value as Depth)}
        aria-label={`Choose review depth: ${depth}`}
        className={`${mine ? "border border-line bg-panel" : "border-l border-on-accent/30 bg-accent text-on-accent"} cursor-pointer px-1.5 text-xs`}
      >
        <option value="quick">Quick</option>
        <option value="standard">Standard</option>
        <option value="deep">Deep</option>
      </select>
      )}
    </span>
  );
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className={`shrink-0 border-b border-line ${compact ? "px-4 pt-2" : "px-6 pt-3.5"}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <MenuButton onClick={onMenu} />
          <button onClick={() => review.goInbox()} className="inline-flex shrink-0 items-center gap-0.5 rounded-md bg-sunken py-1 pl-1 pr-2 text-xs hover:text-accent">
            <ChevronLeft size={14} /> {listName}
          </button>
          {compact ? (
            <h1 className="min-w-0 flex-1 truncate text-sm font-semibold" title={pr.title}>
              {pr.title} <span className="font-normal text-muted">{pr.repo.split("/")[1]} #{pr.number}</span>
            </h1>
          ) : (
            <span className="flex min-w-0 flex-[1_1_22rem] flex-wrap items-center gap-x-1.5 text-xs text-muted">
              <span>
                {pr.repo.split("/")[1]} #{pr.number}
              </span>
              ·
              <span className="inline-flex min-w-0 max-w-full items-center gap-1 font-mono" title={`${pr.head} → ${pr.base}`}>
                <GitBranch size={11} className="shrink-0" /> <span className="min-w-0 truncate">{pr.head} → {pr.base}</span>
              </span>
              ·
              <span>
                <span className="text-success">+{pr.additions}</span> <span className="text-danger">−{pr.deletions}</span>
              </span>
              · <span>by @{pr.author}</span>· <span>updated {ago(pr.updatedAt)} ago</span>
            </span>
          )}
          <span className="flex min-w-0 flex-wrap items-center gap-2">
            <a href={pr.url} target="_blank" rel="noreferrer" className={secondaryBtn}>
              <ExternalLink size={13} /> Open on GitHub
            </a>
            {refreshBtn}
            {mine && (
              <button
                onClick={() => {
                  if (!clone) return;
                  if (!window.confirm(`This switches ${clone} to branch ${pr.head}. Uncommitted work stays but the branch changes. Continue?`)) return;
                  start("Address feedback", addressPrompt(pr), "acceptEdits", clone);
                }} disabled={!clone || busy} title={clone ? (busy ? busyHint : undefined) : "Clone this repo on your Mac first, so Claude can work on the branch."} className={primaryBtn}>
                <Wrench size={14} /> Address feedback
              </button>
            )}
            {reviewBtn}
            {beforeAfter}
            {mine && (
              <button onClick={() => setMerging({ method: "squash", busy: false, error: null })} disabled={!!mergeBlock} title={mergeBlock ?? "Merge it on GitHub"} className={secondaryBtn}>
                <GitMerge size={14} /> Merge
              </button>
            )}
          </span>
        </div>
        {!compact && <h1 className="mt-2.5 text-xl font-semibold leading-snug">{pr.title}</h1>}
        <nav className="-mb-px mt-2 flex items-end gap-5 overflow-x-auto scroll-thin" role="tablist" aria-label="This PR">
          {PR_TABS.map((t) => (
            <TabButton key={t} on={tab === t} onClick={() => setTab(pr.url, t)}>
              <TabNavLabel tab={t} extras={extras} detail={d?.data} />
            </TabButton>
          ))}
          {(tabs.length > 0 || starting?.url === pr.url) && <span className="mb-2.5 h-4 w-px shrink-0 bg-line" aria-hidden />}
          {tabs.map((s) => (
            <TabButton key={s.id} on={tab === s.id} onClick={() => setTab(pr.url, s.id)} title={`Started ${ago(new Date(s.at).toISOString())} ago`}>
              {AUTO_KINDS.has(s.kind) ? <Bot size={12} /> : <Sparkles size={12} />} {tabLabel(s.kind)}
              <span className="font-normal text-muted">· {ago(new Date(s.at).toISOString())}</span>
            </TabButton>
          ))}
          {starting?.url === pr.url && (
            <TabButton on={tab === "new"} onClick={() => setTab(pr.url, "new")}>
              <Loader2 size={12} className="animate-spin" /> {tabLabel(starting.kind)}
            </TabButton>
          )}
        </nav>
      </header>

      {mergedLine}
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
          {merging.error && <span className="w-full text-xs text-danger">{merging.error}</span>}
        </div>
      )}


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
          onReview={reviewNow}
          onAsk={(kind, prompt) => start(kind, prompt, "default", clone ?? home)}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {chat.session?.id === tab &&
            (sessionResult?.kind === "review" ? (
              <ReviewNote result={sessionResult} latest={extras.take?.sessionId === tab} cleared={!!extras.cleared} onOpen={() => setTab(pr.url, "discussion")} />
            ) : (
              <ReviewResults pr={pr} sessionId={tab} messages={chat.session.messages} login={review.board?.login} />
            ))}
          <div className="flex min-h-0 flex-1">{renderChat({ compact: true })}</div>
        </div>
      )}
    </main>
  );
}

// A review session's comments live in Discussion (as drafts, next to the human threads),
// so its tab shows only where they are, and the chat with Claude below.
function ReviewNote({ result, latest, cleared, onOpen }: { result: ReviewResult; latest: boolean; cleared: boolean; onOpen: () => void }) {
  const n = result.findings.length;
  const what = !latest
    ? "An earlier review. The latest review's comments are in Discussion."
    : cleared
      ? "The PR has new commits since this review, so its drafts are cleared. A follow-up review checks them against the new code."
      : n
        ? `${n} comment${n === 1 ? "" : "s"} drafted. Edit, post or discard them in Discussion.`
        : "No comments to post.";
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line bg-sunken/30 px-5 py-2 text-xs">
      <Check size={13} className="shrink-0 text-accent" />
      <span className="font-medium">Review done</span>
      {latest && result.ready && <span className="rounded-full bg-success/10 px-2 py-0.5 font-semibold text-success">Ready to approve</span>}
      <span className="min-w-0 flex-1 text-muted">{what}</span>
      <button onClick={onOpen} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 hover:border-accent hover:text-accent">
        Open Discussion
      </button>
    </div>
  );
}

const REVIEW_KINDS = new Set(["Review", "Self-review", "Auto review", "Autopilot review"]);
const AUTO_KINDS = new Set(["Auto review", "Autopilot review"]);
const tabLabel = (kind: string) => (REVIEW_KINDS.has(kind) ? "Claude review" : kind);

const busyHint = "Claude is still starting the last one. Wait a moment.";

// The newest session of each kind, oldest kind first (older ones of a kind came from
// before reviews carried on in one session, or from earlier auto reviews).
function latestPerKind(list: PrSession[]): PrSession[] {
  const by = new Map<string, PrSession>();
  for (const s of list) {
    const cur = by.get(s.kind);
    if (!cur || s.at > cur.at) by.set(s.kind, s);
  }
  return [...by.values()].sort((a, b) => a.at - b.at);
}

function TabButton({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: ReactNode }) {
  return (
    <button
      role="tab"
      onClick={onClick}
      title={title}
      aria-selected={on}
      className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 pb-2 pt-1 text-sm ${on ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}
    >
      {children}
    </button>
  );
}
