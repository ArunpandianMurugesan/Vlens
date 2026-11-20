import "server-only";
import type { AutoRun, Lifecycle, PrTrack } from "./lifecycle";
import { jsonStore } from "./jsonStore";
import { allRecords } from "./reviewRecords";

// Which PRs you asked Vlens to re-review when new commits land, and the last failed
// auto review per PR. Kept on this Mac (review-watch.json in Vlens's data folder).
// The runner (reviewWatchRunner.ts) acts on it; it never runs on a timer of its own.

interface Saved {
  watch?: Lifecycle["watch"];
  failed?: Lifecycle["failed"];
}
const store = jsonStore<Saved>("review-watch.json", () => ({}));

// The reviews running now, in memory (survives hot reloads, not a restart).
export type LiveRun = AutoRun & { kill?: () => void };
const g = globalThis as { lensWatchRuns?: Map<string, LiveRun> };
export const liveRuns: Map<string, LiveRun> = (g.lensWatchRuns ??= new Map());

export async function lifecycleState(): Promise<Lifecycle> {
  const [saved, records] = await Promise.all([store.load(), allRecords()]);
  const tracks: Record<string, PrTrack> = {};
  for (const [url, r] of Object.entries(records)) {
    const run = r.runs.at(-1);
    const post = r.posts.at(-1);
    tracks[url] = {
      lastRun: run ? { headSha: run.headSha, diffHash: run.diffHash, at: run.at, sessionId: run.sessionId, ...(run.by ? { by: "auto" as const } : {}), ...(run.carried ? { carried: true } : {}) } : null,
      lastPost: post ? { headSha: post.headSha, diffHash: post.diffHash, at: post.at, url: post.url } : null,
    };
  }
  const running = [...liveRuns.values()]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((r): AutoRun => ({ url: r.url, title: r.title, headSha: r.headSha, mode: r.mode, startedAt: r.startedAt, sessionId: r.sessionId, steps: r.steps.slice(-8) }));
  return { tracks, watch: saved.watch ?? {}, running, failed: saved.failed ?? {} };
}

export async function watchList(): Promise<Lifecycle["watch"]> {
  return (await store.load()).watch ?? {};
}

// Switch auto re-review on or off for one PR. `since` is its head commit now: only
// commits after this one start a review.
export function setWatch(url: string, on: boolean, since: string) {
  return store.update((s) => {
    const w = { ...(s.watch ?? {}) };
    if (on) w[url] = { since, at: new Date().toISOString() };
    else delete w[url];
    s.watch = w;
  });
}

// A failed auto review isn't tried again at the same commit (Retry clears it).
export function setFailed(url: string, f: Lifecycle["failed"][string] | null) {
  return store.update((s) => {
    const all = { ...(s.failed ?? {}) };
    if (f) all[url] = f;
    else delete all[url];
    s.failed = all;
  });
}

export async function failedAt(url: string): Promise<string | null> {
  return (await store.load()).failed?.[url]?.headSha ?? null;
}
