/* eslint-disable @typescript-eslint/no-explicit-any -- GitHub responses are untyped JSON */
import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "./paths";
import type { PrDetail, PrLane, PrPriority, PrSummary, ReviewBoard } from "./types";
import { getProvider } from "@/lib/providers";

// Vlens Review reads GitHub through the `gh` CLI, so it uses whatever account
// you're signed in with there. It pulls PRs the way vTower does (vendasta/vtower,
// electron/ipc.cjs gatherPRs + classify): ONE GraphQL request holds every search
// (review requested from you or your teams, your PRs, mentions, commenter), every
// PR still being tracked, and the PRs your team was @-mentioned on (from your
// notifications, which search can't reach). One call per poll keeps us far below
// GitHub's rate limits, including its secondary limit on bursts.

function gh(args: string[], timeout = 25_000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) =>
    execFile("gh", args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (e, stdout, stderr) =>
      resolve({ ok: !e, out: String(stdout), err: String(stderr || (e as Error | null)?.message || "") }),
    ),
  );
}

let meCache: { login: string; at: number } | null = null;
export async function me(): Promise<string | null> {
  if (meCache && Date.now() - meCache.at < 5 * 60_000) return meCache.login; // notices `gh auth switch`
  const r = await gh(["api", "user", "--jq", ".login"], 10_000);
  if (r.ok && r.out.trim()) meCache = { login: r.out.trim(), at: Date.now() };
  return meCache?.login ?? null;
}

let teamsCache: { login: string; teams: string[]; at: number } | null = null;
async function myTeams(login: string): Promise<string[]> {
  if (teamsCache?.login === login && Date.now() - teamsCache.at < 60 * 60_000) return teamsCache.teams; // new teams show within the hour
  const r = await gh(["api", "user/teams", "--paginate", "--jq", '.[] | (.organization.login + "/" + .slug)'], 15_000);
  const teams = r.ok ? r.out.split("\n").map((t) => t.trim()).filter(Boolean) : [];
  if (r.ok) teamsCache = { login, teams, at: Date.now() };
  return teams;
}

const FIELDS = `
  number title url isDraft createdAt updatedAt headRefName baseRefName headRefOid
  additions deletions changedFiles mergeable reviewDecision
  author { login } repository { nameWithOwner }
  labels(first: 6) { nodes { name } }
  latestReviews(first: 50) { nodes { author { login } state commit { oid } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  baseRef { branchProtectionRule { requiredApprovingReviewCount } }`;

const lit = (s: string) => JSON.stringify(s); // safe GraphQL string literal

function toSummary(n: any, login: string, sources: Set<string>): PrSummary | null {
  const reviews: any[] = n.latestReviews?.nodes ?? [];
  const mine = reviews.find((r) => r.author?.login === login);
  const ci = n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null;
  const pr: PrSummary = {
    url: n.url,
    repo: n.repository?.nameWithOwner ?? "",
    number: n.number,
    title: n.title,
    author: n.author?.login ?? "",
    isDraft: !!n.isDraft,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
    head: n.headRefName,
    base: n.baseRefName,
    additions: n.additions ?? 0,
    deletions: n.deletions ?? 0,
    changedFiles: n.changedFiles ?? 0,
    labels: (n.labels?.nodes ?? []).map((l: any) => l.name),
    ci: ci === "SUCCESS" ? "passing" : ci === "FAILURE" || ci === "ERROR" ? "failing" : ci ? "pending" : "none",
    mergeable: n.mergeable ?? "UNKNOWN",
    reviewDecision: n.reviewDecision ?? null,
    approvals: reviews.filter((r) => r.state === "APPROVED").length,
    requiredApprovals: n.baseRef?.branchProtectionRule?.requiredApprovingReviewCount ?? null,
    myReview: mine?.state ?? null,
    // You reviewed an older commit and new code has landed since.
    changedSinceMyReview: !!(mine?.commit?.oid && n.headRefOid && mine.commit.oid !== n.headRefOid),
    lane: "fyi",
    priority: "low",
    why: "",
    ...(sources.has("pinged") ? { pinged: true } : {}),
  };
  const l = lane(pr, login, sources);
  return l ? { ...pr, ...l } : null;
}

// Whose move is it? vTower's attention model: one lane per PR (by whose turn it is and
// how you relate to it), a priority within the lane, and a short reason. null = hidden.
type Lane = { lane: PrLane; priority: PrPriority; why: string };
const DAY = 86_400_000;
function lane(p: PrSummary, login: string, sources: Set<string>): Lane | null {
  const src = [...sources];
  const asked = sources.has("review");
  const teamAsked = src.some((s) => /^team\d/.test(s));
  const pinged = sources.has("pinged");
  // Cleared: the full approval quorum is met; with no review rule, one approval clears it.
  const cleared = p.reviewDecision === "APPROVED" || (p.reviewDecision === null && p.approvals > 0);
  const myReview = p.myReview && p.myReview !== "DISMISSED" ? p.myReview : null;
  const age = Date.now() - Date.parse(p.updatedAt || "0");

  // Your own PRs: blocked on you first, then ready, then waiting; old ones sink but stay.
  if (p.author === login) {
    if (p.isDraft) return { lane: "mine", priority: "low", why: "draft" };
    let base: Omit<Lane, "lane">;
    if (p.reviewDecision === "CHANGES_REQUESTED") base = { priority: "high", why: "changes requested" };
    else if (p.ci === "failing") base = { priority: "high", why: "CI failing" };
    else if (p.mergeable === "CONFLICTING") base = { priority: "high", why: "merge conflict" };
    else if (cleared) base = { priority: "normal", why: "ready to merge" };
    else base = { priority: "low", why: "awaiting review" };
    if (age >= 30 * DAY) return { lane: "mine", priority: "stale", why: `${base.why} · stale` };
    return { lane: "mine", ...base };
  }

  // Someone else's draft isn't ready, unless they asked you directly.
  if (p.isDraft && !asked) return null;
  // A fix landed on something you flagged: your turn again, on top.
  if ((myReview === "CHANGES_REQUESTED" || myReview === "COMMENTED") && p.changedSinceMyReview)
    return { lane: "needsYou", priority: "high", why: "fix pushed · re-review" };
  if (myReview === "APPROVED")
    return cleared ? { lane: "done", priority: "low", why: "approved · ready to merge" } : { lane: "approvedWaiting", priority: "normal", why: "you approved · awaiting others" };
  if (myReview === "CHANGES_REQUESTED") return { lane: "waitingAuthor", priority: "low", why: "changes requested · author's turn" };
  if (myReview === "COMMENTED") return { lane: "waitingAuthor", priority: "low", why: "you commented · author's turn" };
  // You haven't reviewed, and it's approved without you.
  if (cleared) return { lane: "fyi", priority: "low", why: "approved without you" };
  if (asked) {
    const closing = p.approvals > 0;
    return { lane: "needsYou", priority: closing ? "high" : "normal", why: closing ? "awaiting your review · nearly cleared" : "awaiting your review" };
  }
  if (teamAsked || pinged)
    return { lane: "team", priority: p.approvals > 0 ? "high" : "normal", why: pinged && !teamAsked ? "your team was tagged" : "awaiting your team's review" };
  // Mentioned or commented on: just so you know, and gone after a week.
  if (sources.has("mentions") || sources.has("commenter")) return age >= 7 * DAY ? null : { lane: "fyi", priority: "low", why: "mentioned" };
  return { lane: "fyi", priority: "low", why: "tracked" };
}

// Every PR on the board stays until it's merged or closed, even after it drops out of
// the searches (say, the review request cleared once you reviewed): its URL is kept here
// and looked up directly next time. It prunes itself: a PR that's no longer open drops out.
const TRACKED = path.join(DATA_DIR, "review-tracked.json");
const readTracked = async (): Promise<string[]> => JSON.parse(await fs.readFile(TRACKED, "utf8").catch(() => "[]"));
const writeTracked = (urls: string[]) => fs.writeFile(TRACKED, JSON.stringify(urls.slice(0, 60))).catch(() => {});
const prRef = (url: string) => {
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return m ? { owner: m[1], name: m[2], number: Number(m[3]) } : null;
};

// PRs your team (or you) were @-mentioned on. Search's mentions: only knows users, not
// teams; your notifications know both. One REST call, at most 30.
async function pingedPrs(): Promise<string[]> {
  const r = await gh(["api", "/notifications?all=true&participating=true&per_page=100", "--jq", '[.[] | select(.subject.type=="PullRequest" and (.reason=="team_mention" or .reason=="mention")) | .subject.url]'], 12_000);
  if (!r.ok) return [];
  let urls: string[] = [];
  try {
    urls = JSON.parse(r.out) ?? [];
  } catch {}
  return [...new Set(urls.map((u) => u.match(/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)/)).filter(Boolean).map((m) => `https://github.com/${m![1]}/${m![2]}/pull/${m![3]}`))].slice(0, 30);
}

const RANK: Record<PrPriority, number> = { high: 0, normal: 1, low: 2, stale: 3 };

let boardCache: { at: number; board: ReviewBoard } | null = null;
let rateLimitedUntil = 0;

export async function reviewBoard(force = false): Promise<ReviewBoard> {
  if (boardCache && !force && Date.now() - boardCache.at < 60_000) return boardCache.board;
  if (Date.now() < rateLimitedUntil) return { ...(boardCache?.board ?? emptyBoard()), error: "GitHub rate limit hit. Trying again in a few minutes." };

  const login = await me();
  if (!login) return { ...emptyBoard(), error: "The GitHub CLI isn't signed in. Run `gh auth login` in a terminal." };
  const teams = await myTeams(login);

  const searches: [string, string][] = [
    ["review", `review-requested:${login}`],
    ...teams.map((t, i): [string, string] => [`team${i}`, `team-review-requested:${t}`]),
    ["mine", `author:${login}`],
    ["mentions", `mentions:${login}`],
    ["commenter", `commenter:${login}`],
  ];
  // Tracked PRs and team-mentioned ones are looked up by number, in the same call.
  const [tracked, pinged] = await Promise.all([readTracked(), pingedPrs()]);
  const lookups: [string, string, string][] = []; // alias, source, url
  tracked.forEach((u, i) => lookups.push([`t${i}`, "tracked", u]));
  pinged.forEach((u, i) => lookups.push([`p${i}`, "pinged", u]));
  const lookup = ([alias, , url]: [string, string, string]) => {
    const r = prRef(url);
    return r ? `  ${alias}: repository(owner: ${lit(r.owner)}, name: ${lit(r.name)}) { pullRequest(number: ${r.number}) { ...pr state } }` : "";
  };
  const query = `fragment pr on PullRequest {${FIELDS}\n}\nquery {\n${[
    ...searches.map(([alias, q]) => `  ${alias}: search(query: ${lit(`${q} is:pr is:open archived:false`)}, type: ISSUE, first: 30) { nodes { ...pr } }`),
    ...lookups.map(lookup).filter(Boolean),
  ].join("\n")}\n}`;

  const r = await gh(["api", "graphql", "-f", `query=${query}`]);
  let data: any = null;
  try {
    data = JSON.parse(r.out).data; // partial data still comes back if one search failed
  } catch {}
  if (!data) {
    if (/rate limit|secondary|abuse|403/i.test(r.err)) rateLimitedUntil = Date.now() + 3 * 60_000;
    return { ...(boardCache?.board ?? emptyBoard()), error: `Couldn't load PRs from GitHub: ${r.err.slice(0, 200)}` };
  }

  const nodes = new Map<string, { node: any; sources: Set<string> }>();
  for (const [alias] of searches)
    for (const n of data[alias]?.nodes ?? []) {
      if (!n?.url) continue;
      const e = nodes.get(n.url) ?? { node: n, sources: new Set<string>() };
      e.sources.add(alias);
      nodes.set(n.url, e);
    }
  // Tracked and team-mentioned PRs: only while they're still open.
  for (const [alias, source] of lookups) {
    const n = data[alias]?.pullRequest;
    if (!n?.url || n.state !== "OPEN") continue;
    const e = nodes.get(n.url) ?? { node: n, sources: new Set<string>() };
    e.sources.add(source);
    nodes.set(n.url, e);
  }
  // Keep tracking every open PR we saw, until it's merged or closed.
  void writeTracked([...nodes.keys()]);
  const shown = [...nodes.values()]
    .map(({ node, sources }) => {
      const pr = toSummary(node, login, sources);
      if (!pr) return null;
      const teamsAsked = [...sources].filter((s) => /^team\d/.test(s)).map((s) => teams[Number(s.slice(4))]).filter(Boolean);
      return { ...pr, ...(teamsAsked.length ? { teams: teamsAsked } : {}) };
    })
    .filter((p): p is PrSummary => !!p)
    .sort((a, b) => RANK[a.priority] - RANK[b.priority] || b.updatedAt.localeCompare(a.updatedAt));

  const board: ReviewBoard = { login, prs: shown, fetchedAt: new Date().toISOString(), clones: await localClones(), home: os.homedir() };
  boardCache = { at: Date.now(), board };
  return board;
}

const emptyBoard = (): ReviewBoard => ({ login: null, prs: [], fetchedAt: null, clones: {} });

export async function prDetail(url: string): Promise<PrDetail> {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url)) throw new Error("That isn't a GitHub PR link.");
  const fields = "body,files,reviews,statusCheckRollup,comments,createdAt,mergeStateStatus";
  const r = await gh(["pr", "view", url, "--json", fields]);
  if (!r.ok) throw new Error(r.err.slice(0, 300) || "Couldn't load that PR.");
  const d = JSON.parse(r.out);
  return {
    body: d.body ?? "",
    files: (d.files ?? []).map((f: any) => ({ path: f.path, additions: f.additions, deletions: f.deletions })),
    reviews: (d.reviews ?? [])
      .filter((v: any) => v.state !== "PENDING")
      .map((v: any) => ({ author: v.author?.login ?? "", state: v.state, body: v.body ?? "", at: v.submittedAt })),
    checks: (d.statusCheckRollup ?? []).map((c: any) => ({
      name: c.name ?? c.context ?? "check",
      state: (c.conclusion || c.state || c.status || "").toUpperCase(),
      url: c.detailsUrl ?? c.targetUrl ?? null,
    })),
    comments: (d.comments ?? []).length,
    mergeState: d.mergeStateStatus ?? null,
  };
}

// Where each repo is checked out on this Mac, found from the folders your
// sessions ran in. Lets "Review with Claude" start inside the right repo.
let clonesCache: { at: number; clones: Record<string, string> } | null = null;

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) =>
    execFile("git", ["-C", cwd, ...args], { timeout: 5000 }, (e, o) => resolve(e ? null : String(o).trim())),
  );
}

export async function localClones(): Promise<Record<string, string>> {
  if (clonesCache && Date.now() - clonesCache.at < 5 * 60_000) return clonesCache.clones;
  const folders = [...new Set((await (await getProvider()).listSessions()).map((s) => s.cwd).filter((c): c is string => !!c))];
  const clones: Record<string, string> = {};
  const add = async (dir: string) => {
    const remote = await git(dir, ["remote", "get-url", "origin"]);
    const m = remote?.match(/github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/);
    if (m) clones[m[1].toLowerCase()] ??= dir;
  };
  await Promise.all(
    folders.map(async (f) => {
      const top = await git(f, ["rev-parse", "--show-toplevel"]);
      if (top) return add(top);
      // A folder of repos (like ~/code with many clones inside): look one level down.
      const kids = await fs.readdir(f, { withFileTypes: true }).catch(() => []);
      await Promise.all(
        kids
          .filter((k) => k.isDirectory() && !k.name.startsWith(".") && !k.name.startsWith("_"))
          .slice(0, 80)
          .map((k) => fs.access(path.join(f, k.name, ".git")).then(() => add(path.join(f, k.name)), () => {})),
      );
    }),
  );
  clonesCache = { at: Date.now(), clones };
  return clones;
}

// Merge one of your PRs (the Merge button, after you confirm). Only through gh, as you.
export async function mergePr(url: string, method: "squash" | "merge" | "rebase") {
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/.test(url)) throw new Error("That isn't a GitHub PR link.");
  const r = await gh(["pr", "merge", url, `--${method}`], 60_000);
  if (!r.ok) throw new Error(r.err.trim().slice(0, 400) || "GitHub didn't merge it.");
  boardCache = null;
  return { ok: true };
}
