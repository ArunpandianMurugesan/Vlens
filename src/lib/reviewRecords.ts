import "server-only";
import { createHash } from "node:crypto";
import { gh } from "./github";
import { jsonStore } from "./jsonStore";

// What Vlens remembers about each PR's Claude reviews, kept on this Mac (not in the
// browser): which commit each review looked at, and what you posted. It lets Post
// refuse a review whose PR has moved on, and keeps "Posted" across reloads.
//
// A review is tied to the PR's head commit and to a fingerprint of its diff: only the
// added and removed lines, per file, without line numbers. So a rebase or a merge from
// the base branch keeps the fingerprint (nothing new to review), and a real change doesn't.

export interface ReviewRun {
  sessionId: string;
  headSha: string;
  diffHash: string;
  at: string;
}
export interface ReviewPost {
  sessionId: string | null;
  key: string | null; // the results panel's id for the review content
  headSha: string; // the commit the review was posted on
  diffHash: string | null;
  url: string;
  event: string;
  inline: number;
  at: string;
}
export interface PrRecord {
  runs: ReviewRun[];
  posts: ReviewPost[];
}
export interface PrSnapshot {
  headSha: string;
  diffHash: string;
}

const store = jsonStore<Record<string, PrRecord>>("review-records.json", () => ({}));
const KEEP = 20; // runs and posts kept per PR

export const isPrUrl = (url: string) => /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url);

// The +/- lines of a diff, per file, without positions: what a reviewer reads.
export function diffFingerprint(diff: string): string {
  const h = createHash("sha256");
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) file = line;
    else if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    else if ((line.startsWith("+") || line.startsWith("-")) && file) h.update(`${file}\n${line}\n`);
  }
  return h.digest("hex").slice(0, 16);
}

// The PR's head commit and diff fingerprint right now. One gh call each; a short
// cache so opening a panel and posting from it don't fetch the diff twice.
const snapCache = new Map<string, { at: number; snap: PrSnapshot }>();
export async function prSnapshot(url: string, fresh = false): Promise<PrSnapshot> {
  if (!isPrUrl(url)) throw new Error("That isn't a GitHub PR link.");
  const hit = snapCache.get(url);
  if (!fresh && hit && Date.now() - hit.at < 30_000) return hit.snap;
  const head = await gh(["pr", "view", url, "--json", "headRefOid", "--jq", ".headRefOid"]);
  if (!head.ok) throw new Error(head.err.slice(0, 300) || "Couldn't read the PR.");
  const diff = await gh(["pr", "diff", url], 60_000);
  if (!diff.ok) throw new Error(diff.err.slice(0, 300) || "Couldn't read the PR's diff.");
  const snap = { headSha: head.out.trim(), diffHash: diffFingerprint(diff.out) };
  snapCache.set(url, { at: Date.now(), snap });
  return snap;
}

export async function recordsFor(url: string): Promise<PrRecord> {
  return (await store.load())[url] ?? { runs: [], posts: [] };
}

export function recordRun(url: string, run: ReviewRun) {
  return store.update((all) => {
    const r = (all[url] ??= { runs: [], posts: [] });
    r.runs = [...r.runs.filter((x) => x.sessionId !== run.sessionId), run].slice(-KEEP);
  });
}

export function recordPost(url: string, post: ReviewPost) {
  return store.update((all) => {
    const r = (all[url] ??= { runs: [], posts: [] });
    r.posts = [...r.posts, post].slice(-KEEP);
  });
}

export async function allRecords(): Promise<Record<string, PrRecord>> {
  return store.load();
}
