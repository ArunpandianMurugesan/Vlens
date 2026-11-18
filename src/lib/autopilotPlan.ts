import type { PrSummary } from "./types";

// Autopilot's rules, and what they mean for each PR. Shared by the server (which
// stores the rules) and the Review screens (which show, per PR, what autopilot would
// do). Nothing here runs a review: autopilot only plans until it is switched on.

export type Depth = "quick" | "standard" | "deep";
export type WorkflowLane = "needsYou" | "team" | "mine";
// What a workflow does with a review: keep it as a draft you post, show it to you only
// (a self-check), or post it as comments itself. Never an approval.
export type WorkflowThen = "draft" | "private" | "comment";

// One "When → Review → Then → Re-check" recipe. Workflows are checked in order; the
// first one that matches a PR is the one that handles it.
export interface Workflow {
  id: string;
  name: string;
  enabled: boolean;
  lane: WorkflowLane; // when: which PRs (whose move it is)
  repos: string[]; // and only in these repos (owner/name); empty = any
  depth: Depth; // review: how hard it looks
  then: WorkflowThen;
  recheck: boolean; // review again when the PR gets new commits
}

export interface AutopilotRules {
  enabled: boolean; // the master switch
  workflows: Workflow[]; // in order: the first match wins
  // Limits and "hand it to me when…": shared by every workflow.
  intervalMinutes: number; // how often it looks for PRs to review
  dailyCap: number; // reviews per day, at most (they use your Claude plan)
  skipDrafts: boolean;
  skipLabel: string; // a PR with this GitHub label is never picked
  maxChangedLines: number; // bigger PRs go to you instead
  sensitivePaths: string[]; // regexes: a PR touching these goes to you (checked when it runs)
  repos: { include: string[]; exclude: string[] }; // owner/name; empty include = every repo
  handoffNotes: string; // extra "hand it to me when…" rules, in plain words, for Claude
}

export const DEFAULT_WORKFLOWS: Workflow[] = [
  { id: "needs-me", name: "Review PRs that need me", enabled: true, lane: "needsYou", repos: [], depth: "standard", then: "draft", recheck: true },
  { id: "self-check", name: "Self-check my own PRs", enabled: false, lane: "mine", repos: [], depth: "quick", then: "private", recheck: true },
  { id: "team", name: "Team PRs in my repos", enabled: false, lane: "team", repos: [], depth: "quick", then: "draft", recheck: false },
];

export const DEFAULT_RULES: AutopilotRules = {
  enabled: false,
  workflows: DEFAULT_WORKFLOWS,
  intervalMinutes: 10,
  dailyCap: 10,
  skipDrafts: true,
  skipLabel: "skip-ai-review",
  maxChangedLines: 1000,
  sensitivePaths: ["(^|/)migrations?/", "(^|/)(auth|billing|payments?)/", "\\.github/workflows/", "(^|/)(CODEOWNERS|CLAUDE\\.md)$"],
  repos: { include: [], exclude: [] },
  handoffNotes: "",
};

export const LANE_LABEL: Record<WorkflowLane, string> = { needsYou: "Someone asks me to review", team: "My team is asked to review", mine: "I open or push to my PR" };
export const DEPTH_LABEL: Record<Depth, string> = { quick: "Quick: blockers only", standard: "Standard: bugs and risks", deep: "Deep: slow and thorough" };
export const THEN_LABEL: Record<WorkflowThen, string> = { draft: "Draft only. I post it.", private: "Show findings to me only", comment: "Post comments itself" };

const num = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : def);
const list = (v: unknown, def: string[]) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string" && !!s.trim()).map((s) => s.trim()).slice(0, 50) : def);
const oneOf = <T extends string>(v: unknown, all: readonly T[], def: T): T => (all.includes(v as T) ? (v as T) : def);

function normalizeWorkflow(x: unknown, i: number): Workflow | null {
  if (!x || typeof x !== "object") return null;
  const w = x as Partial<Workflow>;
  const lane = oneOf(w.lane, ["needsYou", "team", "mine"] as const, "needsYou");
  return {
    id: typeof w.id === "string" && /^[\w-]{1,40}$/.test(w.id) ? w.id : `wf-${i + 1}`,
    name: typeof w.name === "string" && w.name.trim() ? w.name.trim().slice(0, 80) : "Untitled workflow",
    enabled: typeof w.enabled === "boolean" ? w.enabled : false,
    lane,
    repos: list(w.repos, []).map((s) => s.toLowerCase()),
    depth: oneOf(w.depth, ["quick", "standard", "deep"] as const, "standard"),
    then: oneOf(w.then, ["draft", "private", "comment"] as const, "draft"),
    recheck: typeof w.recheck === "boolean" ? w.recheck : true,
  };
}

// Before workflows, the rules had one set of lanes, one depth and one posting mode.
// Turn those into the default workflows so an older autopilot.json keeps its meaning.
function fromOldRules(r: Record<string, unknown>): Workflow[] {
  const lanes = (r.lanes && typeof r.lanes === "object" ? r.lanes : {}) as Partial<Record<WorkflowLane, boolean>>;
  return DEFAULT_WORKFLOWS.map((w) => ({
    ...w,
    enabled: typeof lanes[w.lane] === "boolean" ? !!lanes[w.lane] : w.enabled,
    depth: oneOf(r.depth, ["quick", "standard", "deep"] as const, w.depth),
    then: w.lane !== "mine" && r.posting === "comment" ? "comment" : w.then,
  }));
}

// Bad or missing values fall back to the defaults, so an old or hand-edited file still works.
export function normalizeRules(x: unknown): AutopilotRules {
  const r = (x && typeof x === "object" ? x : {}) as Partial<AutopilotRules> & Record<string, unknown>;
  const d = DEFAULT_RULES;
  const validRegex = (s: string) => {
    try {
      new RegExp(s);
      return true;
    } catch {
      return false;
    }
  };
  let workflows = Array.isArray(r.workflows) ? r.workflows.map(normalizeWorkflow).filter((w): w is Workflow => !!w).slice(0, 20) : "lanes" in r || "posting" in r || "depth" in r ? fromOldRules(r) : DEFAULT_WORKFLOWS;
  // Ids must be unique: they key the cards and the stats.
  const seen = new Set<string>();
  workflows = workflows.map((w, i) => {
    const id = seen.has(w.id) ? `wf-${i + 1}-${Math.random().toString(36).slice(2, 6)}` : w.id;
    seen.add(id);
    return { ...w, id };
  });
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    workflows,
    intervalMinutes: num(r.intervalMinutes, d.intervalMinutes, 5, 240),
    dailyCap: num(r.dailyCap, d.dailyCap, 1, 100),
    skipDrafts: typeof r.skipDrafts === "boolean" ? r.skipDrafts : d.skipDrafts,
    skipLabel: typeof r.skipLabel === "string" ? r.skipLabel.trim().slice(0, 50) : d.skipLabel,
    maxChangedLines: num(r.maxChangedLines, d.maxChangedLines, 50, 100_000),
    sensitivePaths: list(r.sensitivePaths, d.sensitivePaths).filter(validRegex),
    repos: { include: list(r.repos?.include, []).map((s) => s.toLowerCase()), exclude: list(r.repos?.exclude, []).map((s) => s.toLowerCase()) },
    handoffNotes: typeof r.handoffNotes === "string" ? r.handoffNotes.slice(0, 2000) : d.handoffNotes,
  };
}

// The workflow that handles this PR: the first switched-on one that matches it.
export function workflowFor(pr: PrSummary, r: AutopilotRules): Workflow | null {
  const repo = pr.repo.toLowerCase();
  return r.workflows.find((w) => w.enabled && w.lane === pr.lane && (!w.repos.length || w.repos.includes(repo))) ?? null;
}

// What Vlens knows about a PR's past reviews (from reviewRecords).
export interface PrTrack {
  lastRun: { headSha: string; at: string } | null;
  lastPost: { headSha: string; at: string; url: string } | null;
}

export type ActivityKind = "reviewed" | "posted" | "handed" | "skipped" | "paused" | "resumed" | "rules" | "error";
export interface Activity {
  at: string;
  kind: ActivityKind;
  url?: string;
  title?: string;
  detail: string;
}

export interface AutopilotState {
  rules: AutopilotRules;
  paused: Record<string, string>; // PR url -> when
  activity: Activity[]; // newest first
  tracks: Record<string, PrTrack>; // PR url -> past reviews
  today: number; // reviews started today
}

// One PR, from autopilot's point of view.
export type PlanState =
  | "paused" // you paused it
  | "skip" // the rules leave it out
  | "handoff" // it needs you: too big or too risky for autopilot
  | "queued" // autopilot would review it next
  | "changed" // reviewed before, and the PR has new commits since
  | "reviewed" // reviewed at its current commit
  | "posted"; // a review was posted at its current commit

export interface Plan {
  state: PlanState;
  why: string;
  workflow?: { id: string; name: string }; // the workflow that handles it, if any
}

// What autopilot would do with this PR now. Past reviews come first: a PR you already
// reviewed at this commit isn't "queued", whatever the rules say.
export function planFor(pr: PrSummary, s: Pick<AutopilotState, "rules" | "paused" | "tracks">): Plan {
  const r = s.rules;
  const t = s.tracks[pr.url];
  const at = (sha: string) => sha.slice(0, 7);
  const wf = workflowFor(pr, r);
  const workflow = wf ? { id: wf.id, name: wf.name } : undefined;
  if (t?.lastPost && t.lastPost.headSha === pr.headSha) return { state: "posted", why: `review posted at ${at(pr.headSha)}`, workflow };
  if (t?.lastRun && t.lastRun.headSha === pr.headSha) return { state: "reviewed", why: `reviewed at ${at(pr.headSha)}, not posted`, workflow };
  if (s.paused[pr.url]) return { state: "paused", why: "you paused autopilot for this PR", workflow };
  const changed = !!t?.lastRun && t.lastRun.headSha !== pr.headSha;
  const changedWhy = `new commits since the review at ${at(t?.lastRun?.headSha ?? "")}`;
  const repo = pr.repo.toLowerCase();
  if (r.repos.exclude.includes(repo)) return { state: "skip", why: "repo is excluded in the limits" };
  if (r.repos.include.length && !r.repos.include.includes(repo)) return { state: "skip", why: "repo isn't in the limits' list" };
  if (!wf) return changed ? { state: "changed", why: changedWhy } : { state: "skip", why: "no workflow picks this kind of PR" };
  if (r.skipDrafts && pr.isDraft) return { state: "skip", why: "it's a draft", workflow };
  if (r.skipLabel && pr.labels.some((l) => l.toLowerCase() === r.skipLabel.toLowerCase())) return { state: "skip", why: `labelled ${r.skipLabel}`, workflow };
  if (pr.additions + pr.deletions > r.maxChangedLines) return { state: "handoff", why: `${pr.additions + pr.deletions} changed lines, over the ${r.maxChangedLines} limit`, workflow };
  if (changed) return { state: "changed", why: wf.recheck ? changedWhy : `${changedWhy}; re-check is off in "${wf.name}"`, workflow };
  return { state: "queued", why: r.enabled ? `next in line (${wf.name})` : `would be reviewed once autopilot is on (${wf.name})`, workflow };
}

export const PLAN_LABEL: Record<PlanState, string> = {
  paused: "paused",
  skip: "skipped",
  handoff: "needs you",
  queued: "queued",
  changed: "new changes",
  reviewed: "reviewed",
  posted: "posted",
};
