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

export function ReviewResults({ pr, messages }: { pr: PrSummary; messages: ChatMessage[] }) {
  const result = useMemo(() => resultOf(messages), [messages]);
  const [open, setOpen] = useState(true);
  if (!result) return null;
  return (
    <section className="shrink-0 border-b border-line bg-sunken/30">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm">
        {result.kind === "review" ? <Check size={14} className="text-accent" /> : <ImageIcon size={14} className="text-accent" />}
        <span className="font-medium">{result.kind === "review" ? `Review: ${result.findings.length} finding${result.findings.length === 1 ? "" : "s"}` : `Before and after: ${result.shots.length} view${result.shots.length === 1 ? "" : "s"}`}</span>
        <span className="text-xs text-muted">{result.verdict.toLowerCase().replace("_", " ")}</span>
        <ChevronDown size={14} className={`ml-auto text-muted transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="max-h-[50vh] overflow-y-auto px-4 pb-3 scroll-thin">{result.kind === "review" ? <Findings pr={pr} r={result} /> : <Shots r={result} />}</div>}
    </section>
  );
}

function Findings({ pr, r }: { pr: PrSummary; r: ReviewResult }) {
  const [keep, setKeep] = useState<boolean[]>(() => r.findings.map(() => true));
  const [bodies, setBodies] = useState<string[]>(() => r.findings.map((f) => f.body));
  const [summary, setSummary] = useState(r.summary);
  const [event, setEvent] = useState(r.verdict === "REQUEST_CHANGES" ? "REQUEST_CHANGES" : "COMMENT");
  const [editing, setEditing] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ url: string; note?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setKeep(r.findings.map(() => true));
    setBodies(r.findings.map((f) => f.body));
    setSummary(r.summary);
    setDone(null);
  }, [r]);
  const kept = r.findings.map((f, i) => ({ ...f, body: bodies[i] })).filter((_, i) => keep[i]);
  const post = async () => {
    const what = event === "REQUEST_CHANGES" ? "a request-changes review" : event === "APPROVE" ? "an approval" : "a comment review";
    if (!window.confirm(`Post ${what} with ${kept.length} inline finding${kept.length === 1 ? "" : "s"} on ${pr.repo}#${pr.number}, from your GitHub account?`)) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/review/post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo: pr.repo, number: pr.number, event, body: summary, comments: kept.map((f) => ({ path: f.file, line: f.line, body: f.body })) }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setErr(d.error ?? res.statusText);
    else setDone({ url: d.url, note: d.note });
    setBusy(false);
  };
  const tone = (s?: string) => (s === "high" || s === "critical" ? "bg-red-500/10 text-red-700 dark:text-red-300" : s === "medium" ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-sunken text-muted");
  return (
    <div className="space-y-2.5 text-sm">
      <label className="block space-y-1">
        <span className="text-xs text-muted">Review summary (the review&apos;s top comment)</span>
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} className="w-full resize-y rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent" />
      </label>
      {!r.findings.length && <p className="text-xs text-muted">No findings: the review found nothing worth a comment.</p>}
      <ul className="space-y-1.5">
        {r.findings.map((f, i) => (
          <li key={f.id ?? i} className={`rounded-lg border border-line bg-panel px-3 py-2 ${keep[i] ? "" : "opacity-50"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <input type="checkbox" checked={keep[i]} onChange={(e) => setKeep((k) => k.map((x, j) => (j === i ? e.target.checked : x)))} aria-label={`Keep finding ${i + 1}`} />
              <span className="font-mono text-xs">
                {f.file}
                {f.line ? `:${f.line}` : ""}
              </span>
              {f.severity && <span className={`rounded px-1.5 text-[0.65rem] ${tone(f.severity)}`}>{f.severity}</span>}
              <button onClick={() => setEditing(editing === i ? null : i)} className="ml-auto text-xs text-muted hover:text-ink">
                {editing === i ? "Done" : "Edit"}
              </button>
            </div>
            {editing === i ? (
              <textarea value={bodies[i]} onChange={(e) => setBodies((b) => b.map((x, j) => (j === i ? e.target.value : x)))} rows={4} className="mt-1.5 w-full resize-y rounded-lg border border-line bg-bg px-2.5 py-1.5 font-mono text-xs outline-none focus:border-accent" />
            ) : (
              <div className="mt-1 text-[0.8rem]">
                <Markdown text={bodies[i]} />
              </div>
            )}
          </li>
        ))}
      </ul>
      {err && <p className="text-xs text-red-600">{err}</p>}
      {done ? (
        <p className="text-xs text-green-700 dark:text-green-400">
          Posted from your account.{" "}
          <a href={done.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">
            Open it <ExternalLink size={11} />
          </a>
          {done.note && <span className="block text-muted">{done.note}</span>}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
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
        </div>
      )}
    </div>
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
