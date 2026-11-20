"use client";

import { Bot, Loader2, RotateCcw, Square } from "lucide-react";
import { useState } from "react";
import type { Review } from "@/hooks/useReview";
import { stageOf } from "@/lib/lifecycle";
import type { PrSummary } from "@/lib/types";
import { ago } from "./ReviewSidebar";

// The PR's review lifecycle, on the PR page's rail: where the review stands, the last
// review and post, and the switch that lets Claude re-review new commits by itself
// (as drafts for you; it never posts).

export function LifecycleCard({ review, pr }: { review: Review; pr: PrSummary }) {
  const { life, lifeLoaded, lifeAction } = review;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = life.tracks[pr.url];
  const watching = !!life.watch[pr.url];
  const run = life.running.find((r) => r.url === pr.url);
  const failed = life.failed[pr.url];
  const stage = stageOf(pr, life);
  const act = async (action: "watch" | "unwatch" | "stop" | "retry") => {
    setBusy(true);
    setErr(null);
    const e = await lifeAction(action, pr);
    if (e) setErr(e);
    setBusy(false);
  };
  return (
    <section className="rounded-2xl border border-line bg-panel px-4 py-3.5">
      <div className="mb-2 flex items-center gap-2">
        <Bot size={14} className={watching ? "text-accent" : "text-muted"} />
        <h2 className="text-sm font-semibold">Review lifecycle</h2>
        {stage.chip && <span className="ml-auto rounded-full bg-sunken px-2 py-0.5 text-[0.65rem] font-semibold text-muted">{stage.chip}</span>}
      </div>
      <ul className="space-y-0.5 text-xs text-muted">
        <li>
          Last review: {t?.lastRun ? `${ago(t.lastRun.at)} ago, at ${t.lastRun.headSha.slice(0, 7)}${t.lastRun.by === "auto" ? " (auto)" : ""}` : "none yet"}
        </li>
        <li>
          Last posted:{" "}
          {t?.lastPost ? (
            <a href={t.lastPost.url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">
              {ago(t.lastPost.at)} ago, at {t.lastPost.headSha.slice(0, 7)}
            </a>
          ) : (
            "never"
          )}
        </li>
        <li>PR now at {pr.headSha.slice(0, 7) || "?"}</li>
      </ul>

      <label className="mt-3 flex cursor-pointer items-start gap-2.5">
        <button
          role="switch"
          aria-checked={watching}
          disabled={busy || !lifeLoaded || !pr.headSha}
          onClick={() => void act(watching ? "unwatch" : "watch")}
          className={`relative mt-0.5 h-4 w-7 shrink-0 rounded-full transition disabled:opacity-50 ${watching ? "bg-accent" : "bg-line"}`}
        >
          <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${watching ? "left-3.5" : "left-0.5"}`} />
        </button>
        <span className="text-xs">
          <span className="block font-medium text-ink">Auto re-review new commits</span>
          <span className="text-muted">
            {t?.lastRun
              ? "When the author pushes, Claude checks your earlier comments and only the new code, and leaves drafts in Discussion. Nothing is posted."
              : "When new commits land, Claude reviews the PR and leaves drafts in Discussion. Nothing is posted."}{" "}
            Runs while Vlens is open.
          </span>
        </span>
      </label>

      {run && (
        <div className="mt-2.5 space-y-1 rounded-lg bg-sky-500/10 px-2.5 py-2 text-xs text-sky-800 dark:text-sky-300">
          <span className="flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" /> {run.mode === "followup" ? "Reviewing the new commits" : "Reviewing"} · {ago(run.startedAt)}
            <button onClick={() => void act("stop")} disabled={busy} className="ml-auto inline-flex items-center gap-1 rounded border border-current/30 px-1.5 hover:bg-sky-500/10 disabled:opacity-50">
              <Square size={10} /> Stop
            </button>
          </span>
          {run.steps.at(-1) && <span className="block truncate text-muted">{run.steps.at(-1)!.text}</span>}
        </div>
      )}
      {!run && watching && failed && failed.headSha === pr.headSha && (
        <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-danger/10 px-2.5 py-2 text-xs text-danger">
          <span className="min-w-0 flex-1 break-words">Auto review failed at {failed.headSha.slice(0, 7)}: {failed.error}</span>
          <button onClick={() => void act("retry")} disabled={busy} className="inline-flex shrink-0 items-center gap-1 rounded border border-current/30 px-1.5 hover:bg-danger/10 disabled:opacity-50">
            <RotateCcw size={10} /> Retry
          </button>
        </div>
      )}
      {err && <p className="mt-1.5 text-xs text-danger">{err}</p>}
    </section>
  );
}
