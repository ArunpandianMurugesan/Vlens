/* eslint-disable @typescript-eslint/no-explicit-any -- GitHub responses are untyped JSON */
import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listSessions } from "./sessions";
import type { PrDetail, PrLane, PrSummary, ReviewBoard } from "./types";

// Lens Review reads GitHub through the `gh` CLI, so it uses whatever account
// you're signed in with there. One GraphQL request runs every search at once
// (review requested from you or your teams, your PRs, mentions), which keeps
// us far below GitHub's rate limits even when polling.

function gh(args: string[], timeout = 25_000): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) =>
    execFile("gh", args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (e, stdout, stderr) =>
      resolve({ ok: !e, out: String(stdout), err: String(stderr || (e as Error | null)?.message || "") }),
    ),
  );
}

let meCache: { login: string; at: number } | null = null;
async function me(): Promise<string | null> {
  if (meCache && Date.now() - meCache.at < 5 * 60_000) return meCache.login; // notices `gh auth switch`
  const r = await gh(["api", "user", "--jq", ".login"], 10_000);
  if (r.ok && r.out.trim()) meCache = { login: r.out.trim(), at: Date.now() };
  return meCache?.login ?? null;
}

let teamsCache: { login: string; teams: string[] } | null = null;
async function myTeams(login: string): Promise<string[]> {
  if (teamsCache?.login === login) return teamsCache.teams;
  const r = await gh(["api", "user/teams", "--paginate", "--jq", '.[] | (.organization.login + "/" + .slug)'], 15_000);
  const teams = r.ok ? r.out.split("\n").map((t) => t.trim()).filter(Boolean) : [];
  if (r.ok) teamsCache = { login, teams };
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

function toSummary(n: any, login: string, sources: Set<string>): PrSummary {
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
    why: "",
  };
  return { ...pr, ...lane(pr, login, sources) };
}

// Whose move is it? Sort each PR into one lane, with a short reason.
function lane(p: PrSummary, login: string, sources: Set<string>): { lane: PrLane; why: string } {
  const approved = p.reviewDecision === "APPROVED" || (p.reviewDecision === null && p.approvals > 0);
  if (p.author === login) {
    if (p.isDraft) return { lane: "mine", why: "draft" };
    if (p.reviewDecision === "CHANGES_REQUESTED") return { lane: "mine", why: "changes requested" };
    if (p.ci === "failing") return { lane: "mine", why: "CI failing" };
    if (p.mergeable === "CONFLICTING") return { lane: "mine", why: "merge conflict" };
    return { lane: "mine", why: approved ? "ready to merge" : "waiting for review" };
  }
  const asked = sources.has("review");
  const teamAsked = [...sources].some((s) => s.startsWith("team"));
  if (p.myReview && p.myReview !== "APPROVED" && p.myReview !== "DISMISSED" && p.changedSinceMyReview)
    return { lane: "needsYou", why: "new commits since your review" };
  if (p.myReview === "APPROVED") return approved ? { lane: "done", why: "you approved · ready to merge" } : { lane: "waiting", why: "you approved · needs more approvals" };
  if (p.myReview === "CHANGES_REQUESTED" || p.myReview === "COMMENTED") return { lane: "waiting", why: "waiting on the author" };
  if (approved) return { lane: "fyi", why: "approved without you" };
  if (asked) return { lane: "needsYou", why: p.approvals ? "your review · almost approved" : "your review requested" };
  if (teamAsked) return { lane: "team", why: "your team's review requested" };
  return { lane: "fyi", why: sources.has("mentions") ? "you were mentioned" : "you commented" };
}

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
  const query = `fragment pr on PullRequest {${FIELDS}\n}\nquery {\n${searches
    .map(([alias, q]) => `  ${alias}: search(query: ${lit(`${q} is:pr is:open archived:false`)}, type: ISSUE, first: 30) { nodes { ...pr } }`)
    .join("\n")}\n}`;

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
  const prs = [...nodes.values()].map(({ node, sources }) => toSummary(node, login, sources));
  // Other people's drafts aren't ready for review yet, and old FYIs are noise.
  const shown = prs.filter((p) => !(p.isDraft && p.author !== login && p.lane !== "needsYou") && !(p.lane === "fyi" && Date.now() - Date.parse(p.updatedAt) > 14 * 86_400_000));

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
  const folders = [...new Set((await listSessions()).map((s) => s.cwd).filter((c): c is string => !!c))];
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
