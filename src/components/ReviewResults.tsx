"use client";

import { Check, ChevronDown, ExternalLink, ImageIcon, Loader2, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ChatMessage, PrSummary } from "@/lib/types";
import { Markdown } from "./Markdown";

// What a PR session's skill handed back, shown above its chat on the Review page:
//   review        lens:review in PR Studio mode: findings you pick, edit and post as you
//   before/after  galaxy-before-after: the screenshots, side by side
// Both come from a ```json block at the end of Claude's reply (see reviewPrompt and
// beforeAfterPrompt in ReviewView.tsx).

export type Finding = { id?: string; file: string; line: number; body: string; severity?: string };
type ReviewResult = { kind: "review"; verdict: string; summary: string; findings: Finding[] };
type Shot = { label: string; before?: string; after?: string };
type ShotsResult = { kind: "shots"; verdict: string; summary: string; shots: Shot[] };

const btn = "inline-flex items-center gap-1 rounded-lg border border-line bg-bg px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";
const primary = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50";

// The last ```json block in Claude's replies that holds findings or shots.
export function resultOf(messages: ChatMessage[]): ReviewResult | ShotsResult | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const text = m.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("\n");
    const blocks = [...text.matchAll(/```json\s*([\s\S]*?)```/g)].map((x) => x[1]).reverse();
    for (const raw of blocks) {
      try {
        const j = JSON.parse(raw);
        if (Array.isArray(j.findings))
          return {
            kind: "review",
            verdict: String(j.verdict ?? "COMMENT").toUpperCase(),
            summary: String(j.summary ?? ""),
            findings: j.findings.filter((f: Finding) => f && f.file && f.body).map((f: Finding) => ({ ...f, line: Number(f.line) || 0 })),
          };
        if (Array.isArray(j.shots)) return { kind: "shots", verdict: String(j.verdict ?? ""), summary: String(j.summary ?? ""), shots: j.shots };
      } catch {}
    }
  }
  return null;
}

// Reviews you posted, by PR and review content, so a refresh or coming back later
// still shows them as posted (kept in this browser).
const POSTED_KEY = "lens.reviewPosted";
type Posted = { url: string; note?: string; at: string };
function readPosted(): Record<string, Posted> {
  try {
    return JSON.parse(localStorage.getItem(POSTED_KEY) || "{}");
  } catch {
    return {};
  }
}
function savePosted(key: string, p: Posted) {
  try {
    const all = readPosted();
    all[key] = p;
    // Keep the latest 200.
    const kept = Object.entries(all).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, 200);
    localStorage.setItem(POSTED_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {}
}
// A short, stable id for a review's content (the session refresh hands us a new
// copy every few seconds; only a different review should reset the panel).
function hash(text: string) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return (h >>> 0).toString(36);
}

export function ReviewResults({ pr, messages }: { pr: PrSummary; messages: ChatMessage[] }) {
  const latest = useMemo(() => resultOf(messages), [messages]);
  const text = latest ? JSON.stringify(latest) : "";
  // The same review keeps the same object, so its edits and state survive refreshes.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content on purpose
  const result = useMemo(() => latest, [text]);
  const key = `${pr.repo}#${pr.number}:${hash(text)}`;
  const [posted, setPosted] = useState<Posted | null>(null);
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const p = readPosted()[key] ?? null;
    setPosted(p);
    setOpen(!p); // a posted review folds away, out of the chat's way
  }, [key]);
  if (!result) return null;
  const onPosted = (p: Posted) => {
    savePosted(key, p);
    setPosted(p);
  };
  return (
    <section className="flex max-h-[60vh] shrink-0 flex-col border-b border-line bg-sunken/30">
      <div className="flex items-center gap-2 px-4 py-2 text-sm">
        <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          {result.kind === "review" ? <Check size={14} className="shrink-0 text-accent" /> : <ImageIcon size={14} className="shrink-0 text-accent" />}
          <span className="font-medium">{result.kind === "review" ? `Review: ${result.findings.length} finding${result.findings.length === 1 ? "" : "s"}` : `Before and after: ${result.shots.length} view${result.shots.length === 1 ? "" : "s"}`}</span>
          {result.kind === "review" && !posted && <span className="text-xs text-muted">{result.verdict.toLowerCase().replace("_", " ")}</span>}
          <ChevronDown size={14} className={`text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
        {result.kind === "review" && posted && (
          <span className="flex shrink-0 items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-green-700 dark:text-green-400">
              <Check size={11} /> Posted {when(posted.at)}
            </span>
            {posted.url && (
              <a href={posted.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-muted hover:text-accent">
                Open on GitHub <ExternalLink size={11} />
              </a>
            )}
          </span>
        )}
      </div>
      {open && (result.kind === "review" ? <Findings key={key} pr={pr} r={result} posted={posted} onPosted={onPosted} /> : <div className="overflow-y-auto px-4 pb-3 scroll-thin"><Shots r={result} /></div>)}
    </section>
  );
}

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? `at ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : `on ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function Findings({ pr, r, posted, onPosted }: { pr: PrSummary; r: ReviewResult; posted: Posted | null; onPosted: (p: Posted) => void }) {
  // Mounted again (by key) for a different review, so this state is per review.
  const [keep, setKeep] = useState<boolean[]>(() => r.findings.map(() => true));
  const [bodies, setBodies] = useState<string[]>(() => r.findings.map((f) => f.body));
  const [summary, setSummary] = useState(r.summary);
  const [event, setEvent] = useState(r.verdict === "REQUEST_CHANGES" ? "REQUEST_CHANGES" : "COMMENT");
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const kept = r.findings.map((f, i) => ({ ...f, body: bodies[i] })).filter((_, i) => keep[i]);
  const post = async () => {
    const what = event === "REQUEST_CHANGES" ? "a request-changes review" : event === "APPROVE" ? "an approval" : "a comment review";
    const again = posted ? "\n\nYou already posted this review once; this posts a second one." : "";
    if (!window.confirm(`Post ${what} with ${kept.length} inline finding${kept.length === 1 ? "" : "s"} on ${pr.repo}#${pr.number}, from your GitHub account?${again}`)) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/review/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: pr.repo, number: pr.number, event, body: summary, comments: kept.map((f) => ({ path: f.file, line: f.line, body: f.body })) }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setErr(d.error ?? res.statusText);
    else onPosted({ url: d.url, note: d.note, at: new Date().toISOString() });
    setBusy(false);
  };
  const tone = (s?: string) => (s === "high" || s === "critical" ? "bg-red-500/10 text-red-700 dark:text-red-300" : s === "medium" ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-sunken text-muted");
  const fileUrl = `${pr.url}/files`;
  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3 text-sm scroll-thin">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted">Summary (the review&apos;s top comment)</span>
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} disabled={!!posted} className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm leading-relaxed outline-none focus:border-accent disabled:opacity-70" />
        </label>
        {!r.findings.length && <p className="text-xs text-muted">No findings: the review found nothing worth a comment.</p>}
        {r.findings.length > 0 && <div className="text-xs font-medium text-muted">Inline comments</div>}
        <ul className="space-y-2">
          {r.findings.map((f, i) => (
            <li key={f.id ?? i} className={`overflow-hidden rounded-lg border border-line bg-panel ${keep[i] ? "" : "opacity-50"}`}>
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-sunken/40 px-3 py-1.5">
                {!posted && <input type="checkbox" checked={keep[i]} onChange={(e) => setKeep((k) => k.map((x, j) => (j === i ? e.target.checked : x)))} aria-label={`Keep finding ${i + 1}`} />}
                <a href={fileUrl} target="_blank" rel="noreferrer" title="Open the PR's changed files" className="min-w-0 truncate font-mono text-xs hover:text-accent">
                  {f.file}
                  {f.line ? `:${f.line}` : ""}
                </a>
                {f.severity && <span className={`rounded px-1.5 text-[0.65rem] ${tone(f.severity)}`}>{f.severity}</span>}
                {!posted && (
                  <button onClick={() => setEditing(editing === i ? null : i)} className="ml-auto text-xs text-muted hover:text-ink">
                    {editing === i ? "Done" : "Edit"}
                  </button>
                )}
              </div>
              {editing === i ? (
                <textarea value={bodies[i]} onChange={(e) => setBodies((b) => b.map((x, j) => (j === i ? e.target.value : x)))} rows={5} className="block w-full resize-y border-0 bg-bg px-3 py-2 font-mono text-xs outline-none" />
              ) : (
                <div className="px-3 py-2 text-[0.85rem] leading-relaxed">
                  <Markdown text={bodies[i]} />
                </div>
              )}
            </li>
          ))}
        </ul>
        {posted?.note && <p className="text-xs text-muted">{posted.note}</p>}
      </div>
      {/* Always in view, however long the findings are. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-bg/60 px-4 py-2">
        {err && <p className="w-full text-xs text-red-600">{err}</p>}
        {posted ? (
          <>
            <span className="text-xs text-green-700 dark:text-green-400">Posted from your account {when(posted.at)}.</span>
            <button onClick={() => void post()} disabled={busy} className={`${btn} ml-auto`}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Post again
            </button>
          </>
        ) : (
          <>
            <select value={event} onChange={(e) => setEvent(e.target.value)} className="rounded-lg border border-line bg-bg px-2 py-1 text-xs" aria-label="Kind of review">
              <option value="COMMENT">Comment</option>
              <option value="REQUEST_CHANGES">Request changes</option>
              <option value="APPROVE">Approve</option>
            </select>
            <button onClick={() => void post()} disabled={busy || (!kept.length && !summary.trim())} className={primary}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Post review as me
            </button>
            <span className="text-xs text-muted">
              {kept.length} of {r.findings.length} findings, inline at their lines
            </span>
          </>
        )}
      </div>
    </>
  );
}

function Shots({ r }: { r: ShotsResult }) {
  const img = (p?: string) => (p ? `/api/file/raw?path=${encodeURIComponent(p)}` : null);
  return (
    <div className="space-y-3 text-sm">
      {r.summary && <p className="text-xs text-muted">{r.summary}</p>}
      {r.shots.map((s, i) => (
        <figure key={i} className="space-y-1.5">
          <figcaption className="text-xs font-medium">{s.label}</figcaption>
          <div className="grid gap-2 md:grid-cols-2">
            {(["before", "after"] as const).map((k) => (
              <div key={k} className="space-y-1">
                <div className="text-[0.7rem] text-muted">{k === "before" ? "Before (master)" : "After (this PR)"}</div>
                {img(s[k]) ? (
                  <a href={img(s[k])!} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- local screenshots, served as-is */}
                    <img src={img(s[k])!} alt={`${s.label}, ${k}`} className="w-full rounded-lg border border-line" />
                  </a>
                ) : (
                  <div className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">No screenshot</div>
                )}
              </div>
            ))}
          </div>
        </figure>
      ))}
      <button onClick={() => navigator.clipboard?.writeText(r.shots.map((s) => `${s.label}\n  before: ${s.before ?? "-"}\n  after: ${s.after ?? "-"}`).join("\n"))} className={btn}>
        Copy file paths
      </button>
    </div>
  );
}
