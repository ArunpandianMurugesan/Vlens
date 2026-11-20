import type { PrSummary } from "./types";

// A PR's review lifecycle, as Vlens tracks it on this Mac: you review it with Claude,
// you post, the author pushes, and (if you switched it on for that PR) Claude does a
// follow-up review of the new commits by itself and leaves the drafts for you. Nothing
// is ever posted without your click. Pure and client-safe: the server builds a
// Lifecycle (reviewWatch.ts) and the Review screens read it with stageOf.

// What Vlens knows about a PR's past reviews (from reviewRecords.ts).
export interface PrTrack {
  lastRun: { headSha: string; diffHash: string; at: string; sessionId: string; by?: "auto"; carried?: boolean } | null; // carried: a rebase kept the earlier review
  lastPost: { headSha: string; diffHash: string | null; at: string; url: string } | null;
}

// A follow-up review Claude is doing right now (reviewWatchRunner.ts).
export interface AutoRun {
  url: string;
  title: string;
  headSha: string;
  mode: "full" | "followup";
  startedAt: string;
  sessionId: string | null;
  steps: { at: string; text: string }[]; // newest last
}

export interface Lifecycle {
  tracks: Record<string, PrTrack>; // PR url -> past reviews
  watch: Record<string, { since: string; at: string }>; // PR url -> auto re-review is on (since: head sha when switched on)
  running: AutoRun[];
  failed: Record<string, { headSha: string; at: string; error: string }>; // PR url -> its last failed auto review
}

export const EMPTY_LIFECYCLE: Lifecycle = { tracks: {}, watch: {}, running: [], failed: {} };

export type Stage = "running" | "failed" | "draft" | "posted" | "newCommits" | "none";
export interface StageInfo {
  stage: Stage;
  chip: string;
  detail: string;
  auto: boolean; // the latest review was a follow-up Claude did by itself
}

const at = (sha: string) => sha.slice(0, 7);

// Where a PR stands in its review lifecycle, from Vlens's own records.
export function stageOf(pr: PrSummary, life: Lifecycle): StageInfo {
  const run = life.running.find((r) => r.url === pr.url);
  if (run) return { stage: "running", chip: "Reviewing…", detail: run.mode === "followup" ? "Claude is reviewing the new commits" : "Claude is reviewing it", auto: true };
  const failed = life.failed[pr.url];
  if (failed && failed.headSha === pr.headSha && life.watch[pr.url]) return { stage: "failed", chip: "Review failed", detail: `Auto review failed at ${at(failed.headSha)}: ${failed.error}`, auto: true };
  const t = life.tracks[pr.url];
  const last = t?.lastRun;
  const post = t?.lastPost;
  if (last && last.headSha === pr.headSha) {
    // Posted: at this commit, or at an earlier one with the same changes (a rebase).
    const posted = !!post && (post.headSha === last.headSha || (!!post.diffHash && post.diffHash === last.diffHash));
    const auto = last.by === "auto";
    if (posted) return { stage: "posted", chip: "Posted", detail: `your review is posted at ${at(post!.headSha)}`, auto };
    return { stage: "draft", chip: auto ? "Auto review ready" : "Draft ready", detail: `Claude reviewed it${auto ? " by itself" : ""} at ${at(last.headSha)}. Nothing is posted until you say so.`, auto };
  }
  const seen = post ?? last;
  if (seen && pr.headSha && seen.headSha !== pr.headSha) {
    const watching = !!life.watch[pr.url];
    return { stage: "newCommits", chip: "New commits", detail: `new commits since your review at ${at(seen.headSha)}${watching ? " · auto re-review is on" : ""}`, auto: false };
  }
  return { stage: "none", chip: "", detail: "", auto: false };
}
