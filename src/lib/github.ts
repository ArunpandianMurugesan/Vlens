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
// electron/ipc.cjs gatherPRs + classify): GraphQL searches (review requested from you
// or your teams, your PRs, reviewed by you, mentions, commenter), every PR still being
// tracked, and the PRs your team was @-mentioned on (from your notifications, which
// search can't reach). A handful of small calls per refresh keeps us far below
// GitHub's rate limits and its 10-second limit per query.

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

// myReviews: your own last review, asked for directly. latestReviews drops a reviewer
// whose review was re-requested, so on its own it would say you never reviewed it.
// refUpdateRule: the approvals the branch needs, from rulesets or branch protection.
const FIELDS = (login: string) => `
  number title url isDraft createdAt updatedAt headRefName baseRefName headRefOid
  additions deletions changedFiles mergeable reviewDecision
  author { login } repository { nameWithOwner }
  labels(first: 6) { nodes { name } }
  latestReviews(first: 20) { nodes { author { login } state commit { oid } } }
  myReviews: reviews(author: ${JSON.stringify(login)}, last: 5) { nodes { state commit { oid } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
  baseRef { refUpdateRule { requiredApprovingReviewCount } branchProtectionRule { requiredApprovingReviewCount } }`;

const lit = (s: string) => JSON.stringify(s); // safe GraphQL string literal

function toSummary(n: any, login: string, sources: Set<string>): PrSummary | null {
  const reviews: any[] = n.latestReviews?.nodes ?? [];
  const own = (n.myReviews?.nodes ?? []).filter((r: any) => r.state && r.state !== "PENDING");
  const mine = reviews.find((r) => r.author?.login === login) ?? own[own.length - 1];
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
    requiredApprovals: n.baseRef?.refUpdateRule?.requiredApprovingReviewCount ?? n.baseRef?.branchProtectionRule?.requiredApprovingReviewCount ?? null,
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
  // You reviewed before and the author asked you again: your turn.
  if (asked && myReview && myReview !== "APPROVED")
    return { lane: "needsYou", priority: p.changedSinceMyReview ? "high" : "normal", why: p.changedSinceMyReview ? "re-review requested · new commits" : "re-review requested" };
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

// PRs looked up and found merged or closed: never asked about again (until restart).
const g = globalThis as { lensClosedPrs?: Set<string> };
const closedPrs = (g.lensClosedPrs ??= new Set());

// PRs your team (or you) were @-mentioned on. Search's mentions: only knows users, not
// teams; your notifications know both. One REST call, at most 30.
async function pingedPrs(): Promise<string[]> {
  const since = new Date(Date.now() - 21 * 86_400_000).toISOString(); // older tags are long settled
  const r = await gh(["api", `/notifications?all=true&participating=true&per_page=100&since=${since}`, "--jq", '[.[] | select(.subject.type=="PullRequest" and (.reason=="team_mention" or .reason=="mention")) | .subject.url]'], 12_000);
  if (!r.ok) return [];
  let urls: string[] = [];
  try {
    urls = JSON.parse(r.out) ?? [];
  } catch {}
  return [...new Set(urls.map((u) => u.match(/repos\/([^/]+)\/([^/]+)\/pulls\/(\d+)/)).filter(Boolean).map((m) => `https://github.com/${m![1]}/${m![2]}/pull/${m![3]}`))].slice(0, 30);
}

const RANK: Record<PrPriority, number> = { high: 0, normal: 1, low: 2, stale: 3 };

// One GraphQL call, tried once more when GitHub's own server fails (502, 504, a
// timeout): those are usually momentary. Partial data (one alias failed) still counts.
async function graphql(query: string): Promise<{ data: any; err: string }> {
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await gh(["api", "graphql", "-f", `query=${query}`]);
    try {
      const data = JSON.parse(r.out).data;
      if (data && Object.keys(data).length) return { data, err: "" };
    } catch {}
    last = r.err;
    if (!/\b50[234]\b|timeout|timed out|something went wrong/i.test(r.err)) break;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return { data: null, err: last };
}

let boardCache: { at: number; board: ReviewBoard } | null = null;
let rateLimitedUntil = 0;

export async function reviewBoard(force = false): Promise<ReviewBoard> {
  if (boardCache && !force && Date.now() - boardCache.at < 60_000) return boardCache.board;
  if (Date.now() < rateLimitedUntil) return { ...(boardCache?.board ?? emptyBoard()), error: "GitHub rate limit hit. Trying again in a few minutes." };

  const t0 = Date.now();
  const lap: string[] = []; // where a refresh spends its time (dev log)
  const mark = (what: string) => lap.push(`${what} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  const login = await me();
  if (!login) return { ...emptyBoard(), error: "The GitHub CLI isn't signed in. Run `gh auth login` in a terminal." };
  const teams = await myTeams(login);
  mark("login+teams");
  // GitHub said no: keep showing the last board, with why.
  const failed = (err: string): ReviewBoard => {
    if (/rate limit|secondary|abuse|\b403\b/i.test(err)) rateLimitedUntil = Date.now() + 3 * 60_000;
    const why = /\b50[234]\b|timeout/i.test(err) ? "GitHub's server didn't answer in time. Showing the last list; press Refresh to try again." : `Couldn't load PRs from GitHub: ${err.slice(0, 200)}`;
    return { ...(boardCache?.board ?? emptyBoard()), error: why };
  };

  const searches: [string, string][] = [
    ["review", `review-requested:${login}`],
    ...teams.map((t, i): [string, string] => [`team${i}`, `team-review-requested:${t}`]),
    ["mine", `author:${login}`],
    ["reviewed", `reviewed-by:${login}`],
    ["mentions", `mentions:${login}`],
    ["commenter", `commenter:${login}`],
  ];
  // Light calls, not one heavy one: GitHub stops a GraphQL query after about 10 seconds
  // (HTTP 502), and the searches plus every lookup in one go got close to that. First
  // the searches; then only the tracked and team-mentioned PRs they didn't return.
  const frag = `fragment pr on PullRequest {${FIELDS(login)}\n}`;
  // The searches go as a few small queries at once (GitHub runs each on its own), so the
  // wait is the slowest one, not the sum, and none gets near the limit.
  const chunks: [string, string][][] = [];
  for (let i = 0; i < searches.length; i += 3) chunks.push(searches.slice(i, i + 3));
  const [tracked, pinged, ...parts] = await Promise.all([
    readTracked(),
    pingedPrs(),
    ...chunks.map((c) => graphql(`${frag}\nquery {\n${c.map(([alias, q]) => `  ${alias}: search(query: ${lit(`${q} is:pr is:open archived:false`)}, type: ISSUE, first: 25) { nodes { ...pr } }`).join("\n")}\n}`)),
  ]);
  mark("searches");
  const bad = parts.find((x) => !x.data);
  if (bad) return failed(bad.err);
  const data = Object.assign({}, ...parts.map((x) => x.data));

  const nodes = new Map<string, { node: any; sources: Set<string> }>();
  for (const [alias] of searches)
    for (const n of data[alias]?.nodes ?? []) {
      if (!n?.url) continue;
      const e = nodes.get(n.url) ?? { node: n, sources: new Set<string>() };
      e.sources.add(alias);
      nodes.set(n.url, e);
    }
  // Team-mentioned PRs the searches already found just get the mark.
  for (const u of pinged) nodes.get(u)?.sources.add("pinged");
  // The rest are looked up by number: only while they're still open.
  const lookups: [string, string, string][] = []; // alias, source, url
  const wanted = (u: string) => !nodes.has(u) && !closedPrs.has(u);
  pinged.filter(wanted).forEach((u, i) => lookups.push([`p${i}`, "pinged", u]));
  tracked.filter((u) => wanted(u) && !pinged.includes(u)).forEach((u, i) => lookups.push([`t${i}`, "tracked", u]));
  if (lookups.length) {
    // In small batches, at once.
    const batches: (typeof lookups)[] = [];
    for (let i = 0; i < lookups.length; i += 8) batches.push(lookups.slice(i, i + 8));
    const results = await Promise.all(
      batches.map((b) =>
        graphql(
          `${frag}\nquery {\n${b
            .map(([alias, , url]) => {
              const ref = prRef(url);
              return ref ? `  ${alias}: repository(owner: ${lit(ref.owner)}, name: ${lit(ref.name)}) { pullRequest(number: ${ref.number}) { ...pr state } }` : "";
            })
            .filter(Boolean)
            .join("\n")}\n}`,
        ),
      ),
    );
    mark(`lookups(${lookups.length})`);
    const found = Object.assign({}, ...results.map((x) => x.data ?? {}));
    if (results.every((x) => !x.data)) return failed(results[0].err);
    for (const [alias, source, url] of lookups) {
      const n = found[alias]?.pullRequest;
      if (n && n.state !== "OPEN") closedPrs.add(url);
      if (!n?.url || n.state !== "OPEN") continue;
      const e = nodes.get(n.url) ?? { node: n, sources: new Set<string>() };
      e.sources.add(source);
      nodes.set(n.url, e);
    }
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

  const clones = await localClones();
  mark("clones");
  if (process.env.NODE_ENV === "development") console.log(`  review board: ${lap.join(" · ")}`);
  const board: ReviewBoard = { login, prs: shown, fetchedAt: new Date().toISOString(), clones, home: os.homedir() };
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
