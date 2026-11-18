"use client";

import { Check, CircleDot, ExternalLink, EyeOff, FileCode, FolderGit2, GitBranch, Loader2, MessageSquare, Sparkles, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { Review } from "@/hooks/useReview";
import type { Discussion, ReviewThread, Take } from "@/lib/prDiscussion";
import type { ReviewPost } from "@/lib/reviewRecords";
import type { PrSession } from "@/lib/prSessions";
import type { Finding } from "@/lib/reviewResult";
import type { PrDetail, PrSummary } from "@/lib/types";
import { AutomationCard } from "./Autopilot";
import { levelOf } from "@/lib/risk";
import { Markdown } from "./Markdown";
import { RISK_TONE, RiskBox } from "./RiskBadge";
import { ago, GROUPS, groupOf } from "./ReviewSidebar";

// One PR, in four tabs (Summary, Discussion, Files changed, Checks) with a rail on the
// right: what autopilot does with it, its details, reviewers and sessions. Claude's
// drafts sit next to the human threads, at the same file and line.

export const PR_TABS = ["summary", "discussion", "files", "checks"] as const;
export type PrTab = (typeof PR_TABS)[number];
export const isPrTab = (t: string): t is PrTab => (PR_TABS as readonly string[]).includes(t);

// Claude's latest review of the PR and its GitHub threads, fetched when the PR opens.
export function usePrExtras(url: string | undefined) {
  const [take, setTake] = useState<{ url: string; take: Take | null } | null>(null);
  const [disc, setDisc] = useState<{ url: string; data?: Discussion; error?: string } | null>(null);
  const [posts, setPosts] = useState<{ url: string; posts: ReviewPost[] } | null>(null);
  const load = useCallback(async (u: string) => {
    const q = encodeURIComponent(u);
    const [t, d, r] = await Promise.all([
      fetch(`/api/review/take?url=${q}`).then((x) => x.json()).catch(() => ({ take: null })),
      fetch(`/api/review/discussion?url=${q}`).then((x) => x.json()).catch(() => ({ error: "Couldn't reach Vlens." })),
      fetch(`/api/review/runs?url=${q}`).then((x) => x.json()).catch(() => ({})),
    ]);
    setTake({ url: u, take: t.take ?? null });
    setDisc(d.error ? { url: u, error: d.error } : { url: u, data: d });
    setPosts({ url: u, posts: r.record?.posts ?? [] });
  }, []);
  useEffect(() => {
    if (url) void load(url);
  }, [url, load]);
  // Drafts you discarded here (kept in this browser), by "<session>:<index>".
  const [discarded, setDiscarded] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      setDiscarded(new Set(JSON.parse(localStorage.getItem(DISCARD_KEY) || "[]")));
    } catch {}
  }, []);
  const discard = useCallback((keys: string[]) => {
    setDiscarded((cur) => {
      const next = new Set([...cur, ...keys]);
      try {
        localStorage.setItem(DISCARD_KEY, JSON.stringify([...next].slice(-500)));
      } catch {}
      return next;
    });
  }, []);
  const tk = take && take.url === url ? take.take : null;
  const ps = useMemo(() => (posts && posts.url === url ? posts.posts : []), [posts, url]);
  // Claude's drafts and where each stands. A review posted whole (from the results panel,
  // or "Post all" here) covers them all; one posted here covers itself.
  const drafts = useMemo<Draft[]>(() => {
    if (!tk) return [];
    const sid = tk.sessionId;
    const whole = ps.some((p) => p.sessionId === sid && !p.key?.startsWith("draft:"));
    return tk.result.findings.map((f, i) => {
      const key = `${sid}:${i}`;
      const post = ps.find((p) => p.key === `draft:${key}`);
      return { i, f, key, state: whole ? "posted" : post ? "posted" : discarded.has(key) ? "discarded" : "open", url: post?.url ?? null };
    });
  }, [tk, ps, discarded]);
  return {
    take: tk,
    takeLoaded: !!take && take.url === url,
    discussion: disc && disc.url === url ? disc : null,
    drafts,
    openDrafts: drafts.filter((d) => d.state === "open"),
    discard,
    reload: () => (url ? load(url) : Promise.resolve()),
  };
}
export type Draft = { i: number; f: Finding; key: string; state: "open" | "posted" | "discarded"; url: string | null };
const DISCARD_KEY = "lens.discardedDrafts";
export type PrExtras = ReturnType<typeof usePrExtras>;

const SEV_TONE: Record<string, string> = {
  blocker: "bg-red-500/10 text-red-700 dark:text-red-300",
  should: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  question: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  nit: "bg-sunken text-muted",
};
const sevOf = (f: Finding) => (f.severity && SEV_TONE[f.severity] ? f.severity : "should");

export function TabNavLabel({ tab, extras, detail }: { tab: PrTab; extras: PrExtras; detail: PrDetail | undefined }) {
  const threads = extras.discussion?.data?.threads ?? [];
  const drafts = extras.openDrafts.length;
  switch (tab) {
    case "summary":
      return <>Summary</>;
    case "discussion":
      return (
        <>
          Discussion <Count n={threads.length + drafts} />
        </>
      );
    case "files":
      return (
        <>
          Files changed <Count n={detail?.files.length} />
        </>
      );
    case "checks": {
      const c = detail?.checks ?? [];
      const failed = c.filter((x) => checkTone(x.state) === "bg-red-500").length;
      return (
        <>
          Checks{" "}
          {c.length > 0 && <span className={failed ? "text-red-500" : "text-emerald-600"}>{failed ? `✕ ${failed}` : `✓ ${c.length}`}</span>}
        </>
      );
    }
  }
}

function Count({ n }: { n: number | undefined }) {
  return n ? <span className="rounded-full bg-sunken px-1.5 text-[0.65rem] font-normal text-muted">{n}</span> : null;
}

interface Props {
  tab: PrTab;
  pr: PrSummary;
  review: Review;
  detail: { data?: PrDetail; error?: string } | null;
  extras: PrExtras;
  sessions: PrSession[];
  clone: string | null;
  home: string;
  busy: boolean;
  onTab: (t: string) => void;
  onReview: () => void;
  onAsk: (kind: string, prompt: string) => void;
}

export function PrPage(props: Props) {
  const { tab, detail } = props;
  return (
    <div className="flex min-h-0 flex-1">
      <div className="min-w-0 flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-4xl space-y-4 px-6 py-5">
          {!detail?.data && !detail?.error && (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={14} className="animate-spin" /> Loading details…
            </div>
          )}
          {detail?.error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{detail.error}</p>}
          {detail?.data && tab === "summary" && <SummaryTab {...props} d={detail.data} />}
          {detail?.data && tab === "discussion" && <DiscussionTab {...props} />}
          {detail?.data && tab === "files" && <FilesTab {...props} d={detail.data} />}
          {detail?.data && tab === "checks" && <ChecksTab pr={props.pr} d={detail.data} />}
        </div>
      </div>
      <Rail {...props} />
    </div>
  );
}

// ── Summary ──

function SummaryTab({ pr, review, d, extras, sessions, busy, onTab, onReview }: Props & { d: PrDetail }) {
  const [confirmHide, setConfirmHide] = useState(false);
  const group = GROUPS.find((g) => g.id === groupOf(pr))!;
  const take = extras.take;
  const sev = useMemo(() => {
    const n: Record<string, number> = {};
    for (const f of take?.result.findings ?? []) n[sevOf(f)] = (n[sevOf(f)] ?? 0) + 1;
    return Object.entries(n).map(([k, v]) => `${v} ${k}${v === 1 || k === "should" ? "" : "s"}`);
  }, [take]);
  const stale = take && take.headSha !== pr.headSha;
  const hasSession = take && sessions.some((s) => s.id === take.sessionId);
  return (
    <>
      <div className={`flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm ${group.id === "yours" ? "bg-amber-500/10" : group.id === "ready" ? "bg-emerald-500/10" : "bg-sunken"}`}>
        <span className={`font-medium ${group.tone}`}>{group.label}:</span> {pr.why}
        {pr.isDraft && <span className="rounded bg-panel px-1.5 text-xs text-muted">draft</span>}
        <span className="flex-1" />
        {confirmHide ? (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            Hide this PR from Vlens Review?
            <button onClick={() => review.dismiss(pr.url)} className="rounded-md border border-line px-2 py-0.5 hover:text-ink">
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

      <section className="rounded-2xl border border-violet-500/30 bg-violet-500/5 px-4 py-3.5">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Sparkles size={14} className="text-violet-600 dark:text-violet-300" />
          <h2 className="text-sm font-semibold">Claude&apos;s take</h2>
          {take && (
            <span className="text-xs text-muted">
              from the review at <span className="font-mono">{take.headSha.slice(0, 7)}</span>, {ago(take.at)} ago
            </span>
          )}
          {stale && <span className="rounded bg-amber-500/15 px-1.5 text-[0.65rem] text-amber-800 dark:text-amber-300">PR changed since</span>}
        </div>
        {!extras.takeLoaded ? (
          <p className="text-sm text-muted">Looking for a review…</p>
        ) : take ? (
          <>
            <div className="mb-2.5 flex flex-wrap gap-2 text-xs">
              <Stat label="Verdict" value={take.result.verdict === "REQUEST_CHANGES" ? "Request changes" : "Comment"} tone={take.result.verdict === "REQUEST_CHANGES" ? "text-amber-700 dark:text-amber-400" : ""} />
              <Stat label="Findings" value={sev.length ? sev.join(" · ") : "none"} />
              {(() => {
                const base = review.riskOf(pr).score;
                const adj = take.result.risk?.adjust ?? 0;
                const fin = Math.max(0, Math.min(100, base + adj));
                return <Stat label="Risk" value={adj ? `${base} → ${fin}` : `${fin}`} tone={`rounded px-1 ${RISK_TONE[levelOf(fin)]}`} />;
              })()}
              {take.result.priorChecks.length > 0 && (
                <Stat label="Earlier comments" value={`${take.result.priorChecks.filter((c) => c.status === "fixed").length} of ${take.result.priorChecks.length} fixed`} />
              )}
            </div>
            <p className="text-sm leading-relaxed">{take.result.summary}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {extras.openDrafts.length > 0 && (
                <button onClick={() => onTab("discussion")} className={secondary}>
                  <MessageSquare size={12} /> See the {extras.openDrafts.length} draft{extras.openDrafts.length === 1 ? "" : "s"}
                </button>
              )}
              {hasSession && (
                <button onClick={() => onTab(take.sessionId)} className={secondary}>
                  Open the review to post
                </button>
              )}
              {stale && (
                <button onClick={onReview} disabled={busy} className={secondary}>
                  <Sparkles size={12} /> Review again
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="flex-1 text-sm text-muted">No Claude review of this PR yet.</p>
            <button onClick={onReview} disabled={busy} className={secondary}>
              <Sparkles size={12} /> Review with Claude
            </button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-panel px-4 py-3.5">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sunken text-[0.65rem] font-semibold uppercase text-ink">{pr.author.slice(0, 2)}</span>
          <span>
            <span className="font-medium text-ink">@{pr.author}</span> opened this PR {ago(pr.createdAt)} ago
          </span>
        </div>
        {d.body.trim() ? <Markdown text={d.body} /> : <p className="text-sm text-muted">No description.</p>}
      </section>
    </>
  );
}

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <span className="rounded-lg border border-line bg-panel px-2 py-1">
      <span className="text-muted">{label}</span> <span className={`font-medium ${tone}`}>{value}</span>
    </span>
  );
}

// ── Discussion: Claude's drafts and the review threads, by file and line ──

type Item = { kind: "draft"; key: string; file: string; line: number; d: Draft } | { kind: "thread"; key: string; file: string; line: number; t: ReviewThread };
type Filter = "all" | "open" | "drafts" | "resolved";

// Every GitHub action here runs only on your click, from your account.
async function threadAction(body: object): Promise<{ ok?: boolean; error?: string }> {
  return fetch("/api/review/thread", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then((r) => r.json())
    .catch(() => ({ error: "Couldn't reach Vlens." }));
}

function DiscussionTab({ pr, extras, busy, onAsk, review }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [edits, setEdits] = useState<Record<string, string>>({}); // draft key -> edited text
  const [posting, setPosting] = useState<{ keys: string[]; error?: string; moved?: boolean } | null>(null);
  const [comment, setComment] = useState("");
  const [commentState, setCommentState] = useState<{ busy?: boolean; error?: string; done?: boolean }>({});
  const take = extras.take;
  const disc = extras.discussion;
  const open = extras.openDrafts;
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const d of extras.drafts) if (d.state !== "discarded") out.push({ kind: "draft", key: d.key, file: d.f.file, line: d.f.line, d });
    for (const t of disc?.data?.threads ?? []) out.push({ kind: "thread", key: t.id, file: t.file, line: t.line ?? 0, t });
    return out.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  }, [extras.drafts, disc]);
  const count = (f: Filter) => items.filter((x) => match(x, f)).length;
  const shown = items.filter((x) => match(x, filter));
  const bodyOf = (d: Draft) => (edits[d.key] ?? d.f.body).trim();

  // Post drafts as one GitHub review (one draft, or all open ones). A PR that moved on since
  // the review asks first; "Post anyway" pins it to the commit the review read.
  // `whole`: the review with Claude's summary on top ("Post N as one review"); else just
  // that draft as one comment.
  const post = async (ds: Draft[], whole: boolean, force = false) => {
    if (!take || !ds.length) return;
    const keys = ds.map((d) => d.key);
    setPosting({ keys: whole ? ["*", ...keys] : keys });
    const all = whole;
    const inline = ds.filter((d) => d.f.line > 0);
    const loose = ds.filter((d) => !(d.f.line > 0));
    const body = [all ? take.result.summary : "", ...loose.map((d) => `**${d.f.file}**: ${bodyOf(d)}`)].filter(Boolean).join("\n\n");
    const r = await fetch("/api/review/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        repo: pr.repo,
        number: pr.number,
        event: "COMMENT",
        body,
        comments: inline.map((d) => ({ path: d.f.file, line: d.f.line, body: bodyOf(d) })),
        sessionId: take.sessionId,
        key: all ? `drafts:${take.sessionId}` : `draft:${ds[0].key}`,
        force,
      }),
    })
      .then(async (x) => ({ status: x.status, j: await x.json().catch(() => ({})) }))
      .catch(() => ({ status: 0, j: { error: "Couldn't reach Vlens." } }));
    if (r.status === 409 && r.j.moved) return setPosting({ keys: whole ? ["*", ...keys] : keys, moved: true, error: `The PR has new commits since this review (${String(r.j.reviewedSha).slice(0, 7)} → ${String(r.j.currentSha).slice(0, 7)}).` });
    if (r.j.error) return setPosting({ keys: whole ? ["*", ...keys] : keys, error: r.j.error });
    setPosting(null);
    await Promise.all([extras.reload(), review.loadAuto()]);
  };
  const leaveComment = async () => {
    setCommentState({ busy: true });
    const r = await threadAction({ action: "comment", url: pr.url, body: comment });
    if (r.error) return setCommentState({ error: r.error });
    setComment("");
    setCommentState({ done: true });
    await extras.reload();
  };

  return (
    <>
      {open.length > 0 && take && (
        <section className="space-y-2 rounded-2xl border border-violet-500/30 bg-violet-500/5 px-4 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-[0.7rem] font-bold text-violet-700 dark:text-violet-300">AP</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">
                Claude drafted {open.length} comment{open.length === 1 ? "" : "s"}
              </div>
              <div className="text-xs text-muted">
                Reviewed at <span className="font-mono">{take.headSha.slice(0, 7)}</span> · nothing is posted yet
              </div>
            </div>
            <button onClick={() => extras.discard(open.map((d) => d.key))} disabled={!!posting && !posting.error} className={secondary}>
              Discard all
            </button>
            <button onClick={() => void post(open, true)} disabled={!!posting && !posting.error} className={primary}>
              {posting && !posting.error && posting.keys[0] === "*" ? <Loader2 size={12} className="animate-spin" /> : null} Post {open.length} as one review
            </button>
          </div>
          {posting?.error && posting.keys[0] === "*" && <PostError p={posting} onForce={() => void post(open, true, true)} onCancel={() => setPosting(null)} />}
        </section>
      )}
      <div className="flex flex-wrap gap-1.5">
        {(
          [
            ["all", "All"],
            ["open", "Open"],
            ["drafts", "Claude drafts"],
            ["resolved", "Resolved"],
          ] as const
        ).map(([f, label]) => (
          <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f} className={`rounded-full border px-2.5 py-0.5 text-xs ${filter === f ? "border-accent bg-accent/10 text-accent" : "border-line text-muted hover:text-ink"}`}>
            {label} {count(f)}
          </button>
        ))}
      </div>
      {!disc && (
        <p className="flex items-center gap-2 text-xs text-muted">
          <Loader2 size={13} className="animate-spin" /> Loading comments…
        </p>
      )}
      {disc?.error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{disc.error}</p>}
      {disc?.data && !shown.length && <p className="text-sm text-muted">Nothing here.</p>}
      <div className="space-y-3">
        {shown.map((x) =>
          x.kind === "draft" ? (
            <DraftCard
              key={x.key}
              d={x.d}
              text={edits[x.d.key]}
              onEdit={(t) => setEdits((e) => ({ ...e, [x.d.key]: t }))}
              posting={posting && posting.keys[0] !== "*" && posting.keys[0] === x.d.key ? posting : null}
              onPost={(force) => void post([x.d], false, force)}
              onCancelPost={() => setPosting(null)}
              onDiscard={() => extras.discard([x.d.key])}
            />
          ) : (
            <ThreadCard
              key={x.key}
              pr={pr}
              t={x.t}
              busy={busy}
              onChanged={() => void extras.reload()}
              onAsk={() =>
                onAsk(
                  "Ask Claude",
                  [
                    `On pull request #${pr.number} in ${pr.repo} (${pr.url}) there is a review thread on ${x.t.file}${x.t.line ? `:${x.t.line}` : ""}:`,
                    "",
                    ...x.t.comments.map((c) => `@${c.author}: ${c.body}`),
                    "",
                    "Explain in plain words what is being asked, check the current code on the PR, and suggest a reply (or the fix). Never post, reply, approve or push on GitHub.",
                  ].join("\n"),
                )
              }
            />
          ),
        )}
      </div>
      {!!disc?.data?.conversation.length && (
        <section className="space-y-2 pt-2">
          <h3 className="text-xs font-semibold text-muted">Conversation</h3>
          {disc.data.conversation.map((c) => (
            <div key={c.id} className="rounded-xl border border-line bg-panel px-3 py-2 text-sm">
              <div className="mb-1 flex items-center gap-2 text-xs text-muted">
                <span className="font-medium text-ink">@{c.author}</span> {ago(c.at)} ago
                <a href={c.url} target="_blank" rel="noreferrer" className="ml-auto hover:text-accent" aria-label="Open on GitHub">
                  <ExternalLink size={11} />
                </a>
              </div>
              <Markdown text={c.body} />
            </div>
          ))}
        </section>
      )}
      <section className="space-y-1.5">
        <label className="flex items-start gap-2 rounded-xl border border-line bg-panel px-3 py-2">
          <span className="sr-only">Leave a comment</span>
          <textarea
            value={comment}
            onChange={(e) => {
              setComment(e.target.value);
              setCommentState({});
            }}
            rows={comment.includes("\n") ? 4 : 1}
            placeholder="Leave a comment on the PR"
            className="min-w-0 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <button onClick={() => void leaveComment()} disabled={!comment.trim() || commentState.busy} className={primary}>
            {commentState.busy ? <Loader2 size={12} className="animate-spin" /> : null} Comment
          </button>
        </label>
        {commentState.error && <p className="text-xs text-red-600">{commentState.error}</p>}
        {commentState.done && <p className="text-xs text-emerald-700 dark:text-emerald-400">Posted on GitHub.</p>}
        <p className="text-xs text-muted">Posts go out from your GitHub account when you click. Vlens and Autopilot never approve.</p>
      </section>
    </>
  );
}

function PostError({ p, onForce, onCancel }: { p: { error?: string; moved?: boolean }; onForce: () => void; onCancel: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-300">
      <span className="min-w-0 flex-1">{p.error}</span>
      {p.moved && (
        <button onClick={onForce} className="rounded-md border border-current px-2 py-0.5 font-medium">
          Post anyway
        </button>
      )}
      <button onClick={onCancel} className="px-1 hover:underline">
        {p.moved ? "Cancel" : "OK"}
      </button>
    </div>
  );
}

function match(x: Item, f: Filter) {
  if (f === "all") return true;
  if (f === "drafts") return x.kind === "draft";
  if (x.kind === "draft") return f === "open" && x.d.state === "open";
  return f === "resolved" ? x.t.resolved : !x.t.resolved;
}

function Where({ file, line, chip }: { file: string; line: number | null; chip: ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 font-mono text-xs">
      <FileCode size={12} className="shrink-0 text-muted" />
      <span className="min-w-0 flex-1 truncate" title={file}>
        {file}
        {line ? <span className="text-muted"> line {line}</span> : null}
      </span>
      {chip}
    </div>
  );
}

function DraftCard({
  d,
  text,
  onEdit,
  posting,
  onPost,
  onCancelPost,
  onDiscard,
}: {
  d: Draft;
  text: string | undefined;
  onEdit: (t: string) => void;
  posting: { error?: string; moved?: boolean } | null;
  onPost: (force: boolean) => void;
  onCancelPost: () => void;
  onDiscard: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const s = sevOf(d.f);
  const posted = d.state === "posted";
  const body = text ?? d.f.body;
  return (
    <article className={`overflow-hidden rounded-xl border ${posted ? "border-line bg-sunken/40" : "border-violet-500/30 bg-panel"}`}>
      <Where
        file={d.f.file}
        line={d.f.line}
        chip={
          posted ? (
            d.url ? (
              <a href={d.url} target="_blank" rel="noreferrer" className="rounded bg-emerald-500/10 px-1.5 font-sans text-[0.65rem] text-emerald-700 hover:underline dark:text-emerald-400">
                Posted
              </a>
            ) : (
              <span className="rounded bg-emerald-500/10 px-1.5 font-sans text-[0.65rem] text-emerald-700 dark:text-emerald-400">Posted</span>
            )
          ) : (
            <span className="rounded bg-violet-500/10 px-1.5 font-sans text-[0.65rem] text-violet-700 dark:text-violet-300">Draft · not posted</span>
          )
        }
      />
      <div className="flex gap-2.5 px-3 py-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-[0.6rem] font-bold text-violet-700 dark:text-violet-300">AP</span>
        <div className="min-w-0 flex-1 space-y-2 text-sm">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-medium">Claude</span>
            <span className={`rounded px-1 text-[0.65rem] ${SEV_TONE[s]}`}>{s}</span>
            {text !== undefined && text !== d.f.body && <span className="text-muted">· edited</span>}
          </div>
          {editing ? (
            <textarea value={body} onChange={(e) => onEdit(e.target.value)} rows={Math.min(10, body.split("\n").length + 2)} className="w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent" autoFocus />
          ) : (
            <Markdown text={body} />
          )}
          {!posted && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => onPost(false)} disabled={!!posting && !posting.error} className={primary}>
                {posting && !posting.error ? <Loader2 size={12} className="animate-spin" /> : null} Post
              </button>
              <button onClick={() => setEditing((e) => !e)} className={secondary}>
                {editing ? "Done" : "Edit"}
              </button>
              <button onClick={onDiscard} className={secondary}>
                Discard
              </button>
            </div>
          )}
          {posting?.error && <PostError p={posting} onForce={() => onPost(true)} onCancel={onCancelPost} />}
        </div>
      </div>
    </article>
  );
}

function ThreadCard({ pr, t, busy, onAsk, onChanged }: { pr: PrSummary; t: ReviewThread; busy: boolean; onAsk: () => void; onChanged: () => void }) {
  const [open, setOpen] = useState(!t.resolved);
  const [reply, setReply] = useState("");
  const [state, setState] = useState<{ busy?: string; error?: string }>({});
  const hunk = t.diffHunk.split("\n").slice(-4);
  const act = async (action: "reply" | "resolve" | "unresolve") => {
    setState({ busy: action });
    const first = t.comments[0];
    const r = await threadAction(action === "reply" ? { action, url: pr.url, commentId: first?.id, body: reply } : { action, url: pr.url, threadId: t.id });
    if (r.error) return setState({ error: r.error });
    if (action === "reply") setReply("");
    setState({});
    onChanged();
  };
  const chip = t.resolved ? (
    <span className="rounded bg-emerald-500/10 px-1.5 font-sans text-[0.65rem] text-emerald-700 dark:text-emerald-400">Resolved</span>
  ) : (
    <span className="rounded bg-amber-500/15 px-1.5 font-sans text-[0.65rem] text-amber-800 dark:text-amber-300">Open · {t.comments.length > 1 ? `${t.comments.length - 1} repl${t.comments.length === 2 ? "y" : "ies"}` : "no replies"}</span>
  );
  return (
    <article className={`overflow-hidden rounded-xl border border-line ${t.resolved ? "bg-sunken/40" : "bg-panel"}`}>
      <button onClick={() => setOpen((o) => !o)} className="block w-full text-left">
        <Where file={t.file} line={t.line} chip={<>{t.outdated && <span className="font-sans text-[0.65rem] text-muted">outdated</span>}{chip}</>} />
      </button>
      {open && (
        <>
          {hunk.some((l) => l.trim()) && (
            <pre className="overflow-x-auto border-b border-line bg-sunken/60 px-3 py-1.5 text-[0.7rem] leading-relaxed scroll-thin">
              {hunk.map((l, i) => (
                <div key={i} className={l.startsWith("+") ? "text-emerald-700 dark:text-emerald-400" : l.startsWith("-") ? "text-red-600" : "text-muted"}>
                  {l || " "}
                </div>
              ))}
            </pre>
          )}
          <div className="space-y-2.5 px-3 py-2.5">
            {t.comments.map((c) => (
              <div key={c.id} className="flex gap-2.5 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sunken text-[0.6rem] font-semibold uppercase">{c.author.slice(0, 2)}</span>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 text-xs text-muted">
                    <span className="font-medium text-ink">@{c.author}</span> · {ago(c.at)} ago
                    <a href={c.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-block align-middle hover:text-accent" aria-label="Open on GitHub">
                      <ExternalLink size={10} />
                    </a>
                  </div>
                  <Markdown text={c.body} />
                </div>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <label className="flex min-w-[12rem] flex-1 items-center rounded-lg border border-line bg-bg px-2.5 py-1">
                <span className="sr-only">Reply</span>
                <input
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && reply.trim() && void act("reply")}
                  placeholder="Reply…"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
                />
              </label>
              {reply.trim() && (
                <button onClick={() => void act("reply")} disabled={!!state.busy} className={primary}>
                  {state.busy === "reply" ? <Loader2 size={12} className="animate-spin" /> : null} Reply
                </button>
              )}
              <button onClick={onAsk} disabled={busy} className={secondary}>
                <Sparkles size={12} /> Ask Claude
              </button>
              <button onClick={() => void act(t.resolved ? "unresolve" : "resolve")} disabled={!!state.busy} className={secondary}>
                {state.busy === "resolve" || state.busy === "unresolve" ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} {t.resolved ? "Unresolve" : "Resolve"}
              </button>
            </div>
            {state.error && <p className="text-xs text-red-600">{state.error}</p>}
          </div>
        </>
      )}
    </article>
  );
}

// ── Files and Checks ──

function FilesTab({ d, extras }: Props & { d: PrDetail }) {
  const per = useMemo(() => {
    const n: Record<string, { drafts: number; threads: number }> = {};
    for (const d of extras.openDrafts) (n[d.f.file] ??= { drafts: 0, threads: 0 }).drafts++;
    for (const t of extras.discussion?.data?.threads ?? []) if (!t.resolved) (n[t.file] ??= { drafts: 0, threads: 0 }).threads++;
    return n;
  }, [extras]);
  return (
    <Card title="Files changed" note={`${d.files.length} file${d.files.length === 1 ? "" : "s"}`}>
      <ul className="divide-y divide-line">
        {d.files.map((f) => {
          const n = per[f.path];
          return (
            <li key={f.path} className="flex items-center gap-2 py-1.5 font-mono text-xs">
              <FileCode size={12} className="shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate" title={f.path}>
                {f.path}
              </span>
              {n?.drafts ? <span className="rounded bg-violet-500/10 px-1.5 font-sans text-[0.65rem] text-violet-700 dark:text-violet-300">{n.drafts} draft{n.drafts === 1 ? "" : "s"}</span> : null}
              {n?.threads ? <span className="rounded bg-amber-500/15 px-1.5 font-sans text-[0.65rem] text-amber-800 dark:text-amber-300">{n.threads} open</span> : null}
              {f.additions > 0 && <span className="text-emerald-600">+{f.additions}</span>}
              {f.deletions > 0 && <span className="text-red-500">−{f.deletions}</span>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ChecksTab({ pr, d }: { pr: PrSummary; d: PrDetail }) {
  return (
    <Card title="Checks" note={pr.mergeable === "CONFLICTING" ? <span className="text-red-500">has conflicts</span> : pr.mergeable === "MERGEABLE" ? "no conflicts" : "checking conflicts"}>
      {d.checks.length ? (
        <ul className="space-y-1.5">
          {d.checks.map((c, i) => (
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
  );
}

// ── The rail ──

const REVIEW_STATE: Record<string, string> = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", COMMENTED: "Commented", DISMISSED: "Dismissed" };

function Rail({ pr, review, detail, extras, sessions, clone, home, onTab }: Props) {
  const d = detail?.data;
  // Each reviewer's latest review.
  const reviewers = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of d?.reviews ?? []) m.set(r.author, r.state);
    return [...m];
  }, [d]);
  const shortPath = (p: string) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  const failed = d?.checks.filter((c) => checkTone(c.state) === "bg-red-500").length ?? 0;
  return (
    <aside className="hidden w-80 shrink-0 space-y-3 overflow-y-auto border-l border-line px-4 py-5 scroll-thin lg:block">
      <AutomationCard review={review} pr={pr} />
      <RiskBox risk={review.riskOf(pr)} adjust={extras.take?.headSha === pr.headSha ? extras.take.result.risk : null} />
      <RailBox title="Details">
        <Row k="Branch">
          <span className="flex min-w-0 items-center gap-1 font-mono text-xs">
            <GitBranch size={11} className="shrink-0" /> <span className="truncate">{pr.head}</span>
          </span>
        </Row>
        <Row k="Changes">
          <span className="text-emerald-600">+{pr.additions}</span> <span className="text-red-500">−{pr.deletions}</span> <span className="text-muted">· {pr.changedFiles} files</span>
        </Row>
        {pr.labels.length > 0 && (
          <Row k="Labels">
            <span className="flex flex-wrap gap-1">
              {pr.labels.map((l) => (
                <span key={l} className="rounded bg-sunken px-1.5 text-xs">
                  {l}
                </span>
              ))}
            </span>
          </Row>
        )}
        <Row k="Merge">{pr.mergeable === "CONFLICTING" ? <span className="text-red-500">Conflicts</span> : pr.mergeable === "MERGEABLE" ? "No conflicts" : "Checking…"}</Row>
        <Row k="Checks">
          {!d?.checks.length ? <span className="text-muted">None</span> : failed ? <span className="text-red-500">{failed} failing</span> : <span className="text-emerald-600">All pass</span>}
        </Row>
      </RailBox>
      <RailBox title="Reviewers">
        {reviewers.length ? (
          reviewers.map(([who, state]) => (
            <Row key={who} k={`@${who}`}>
              <span className={`flex items-center gap-1 ${state === "APPROVED" ? "text-emerald-600" : state === "CHANGES_REQUESTED" ? "text-amber-700 dark:text-amber-400" : "text-muted"}`}>
                {state === "APPROVED" ? <Check size={12} /> : state === "CHANGES_REQUESTED" ? <CircleDot size={12} /> : <MessageSquare size={12} />}
                {REVIEW_STATE[state] ?? state.toLowerCase()}
              </span>
            </Row>
          ))
        ) : (
          <p className="text-xs text-muted">No reviews yet.</p>
        )}
        <p className="pt-1 text-[0.7rem] text-muted">Approve stays on GitHub. Vlens and Autopilot never approve.</p>
      </RailBox>
      <RailBox title="This PR's sessions">
        {sessions.map((s) => (
          <div key={s.id} className="flex items-center gap-2 text-sm">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{s.kind}</span>
            <span className="text-xs text-muted">{ago(new Date(s.at).toISOString())}</span>
            <button onClick={() => onTab(s.id)} className="rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent hover:text-accent">
              Open
            </button>
          </div>
        ))}
        {!sessions.length && <p className="text-xs text-muted">None yet. Review with Claude starts one here.</p>}
        <p className="flex items-start gap-1.5 pt-1 text-[0.7rem] text-muted">
          <FolderGit2 size={12} className="mt-0.5 shrink-0" />
          {clone ? (
            <span>
              Claude runs in your clone at <span className="font-mono">{shortPath(clone)}</span>.
            </span>
          ) : (
            <span>No local clone of {pr.repo}, so Claude reads the PR with gh.</span>
          )}
        </p>
      </RailBox>
    </aside>
  );
}

function RailBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5 rounded-2xl border border-line bg-panel px-3.5 py-3">
      <h2 className="text-xs font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 truncate text-muted">{k}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

// ── Shared bits ──

const primary = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50";
const secondary = "inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";

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

export function checkTone(state: string) {
  if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)) return "bg-emerald-500";
  if (["FAILURE", "ERROR", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(state)) return "bg-red-500";
  return "bg-amber-500";
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
