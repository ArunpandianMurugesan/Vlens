import type { PrTrack } from "./lifecycle";
import type { PrSummary } from "./types";

// The Inbox's "New" tab: what changed on each PR since you last had it open. Vlens keeps
// a small snapshot of each PR as you leave it (in this browser) and compares.

export interface Seen {
  at: string; // when you last had it open
  headSha: string;
  ci: PrSummary["ci"];
  decision: string | null;
  updatedAt: string;
}

const KEY = "lens.prSeen";

export function readSeen(): Record<string, Seen> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null; // never used: the caller sets a baseline
    const o = JSON.parse(raw);
    return o && typeof o === "object" ? o : {};
  } catch {
    return {};
  }
}

export function writeSeen(all: Record<string, Seen>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

export const snapshot = (p: PrSummary): Seen => ({ at: new Date().toISOString(), headSha: p.headSha, ci: p.ci, decision: p.reviewDecision, updatedAt: p.updatedAt });

export type NewsTone = "orange" | "blue" | "red" | "green" | "violet";
export interface News {
  chip: string;
  tone: NewsTone;
  detail: string;
  icon: "claude" | "ci" | "approved" | "commits" | "activity" | "new";
}

// The one thing worth telling you about this PR since you last looked, or null.
// Most urgent first: a draft from Claude waiting on you, then CI, reviews, pushes, talk.
export function newsFor(p: PrSummary, seen: Seen | undefined, track: PrTrack | undefined): News | null {
  if (!seen) {
    if (p.isDraft || p.priority === "stale") return null; // listed in their folded sections, not news
    if (p.lane === "needsYou") return { chip: "New", tone: "blue", detail: "asks for your review", icon: "new" };
    if (p.lane === "team") return { chip: "New", tone: "blue", detail: "asks your team for a review", icon: "new" };
    return null;
  }
  const run = track?.lastRun;
  const post = track?.lastPost;
  // Posted after this review, or posted with the same changes (a rebase carried the review over).
  const posted = !!post && !!run && (Date.parse(post.at) >= Date.parse(run.at) || (!!post.diffHash && post.diffHash === run.diffHash));
  if (run && !posted && run.headSha === p.headSha && Date.parse(run.at) > Date.parse(seen.at))
    return { chip: run.by === "auto" ? "Auto review ready" : "Draft ready", tone: "orange", detail: `Claude reviewed it${run.by === "auto" ? " by itself" : ""} at ${run.headSha.slice(0, 7)}. Nothing is posted until you say so.`, icon: "claude" };
  if (p.ci === "failing" && seen.ci !== "failing") return { chip: "CI failed", tone: "red", detail: p.lane === "mine" ? "a check failed on your latest push" : "a check failed on the latest push", icon: "ci" };
  if (p.reviewDecision !== seen.decision) {
    if (p.reviewDecision === "APPROVED") return { chip: "Approved", tone: "green", detail: p.lane === "mine" ? "approved, ready to merge once checks pass" : "approved", icon: "approved" };
    if (p.reviewDecision === "CHANGES_REQUESTED") return { chip: "Changes requested", tone: "orange", detail: "a reviewer asked for changes", icon: "activity" };
  }
  if (p.headSha && seen.headSha && p.headSha !== seen.headSha) return { chip: "New commits", tone: "violet", detail: `pushed since you looked (now ${p.headSha.slice(0, 7)})`, icon: "commits" };
  if (Date.parse(p.updatedAt) > Date.parse(seen.updatedAt)) return { chip: "New activity", tone: "blue", detail: "new comments or reviews since you looked", icon: "activity" };
  return null;
}
