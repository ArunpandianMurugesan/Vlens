import "server-only";
import fs from "node:fs/promises";
import { gh } from "./github";
import { parseResult, type ReviewResult } from "./reviewResult";
import { isPrUrl, recordsFor } from "./reviewRecords";
import { findSessionFile } from "./sessions";

// What a PR's page shows besides GitHub's own summary: the review threads (with their
// resolved / outdated state, which only GitHub's GraphQL API has) and Claude's latest
// review of it, read back from that review's session.

export interface ThreadComment {
  id: number;
  author: string;
  body: string;
  at: string;
  url: string;
}
export interface ReviewThread {
  id: string;
  file: string;
  line: number | null; // null when the code moved on (outdated)
  resolved: boolean;
  outdated: boolean;
  diffHunk: string; // the code the first comment was left on
  comments: ThreadComment[];
}
export interface Discussion {
  threads: ReviewThread[];
  conversation: ThreadComment[]; // the PR's own comments (not on a line)
}

const QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $n) {
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line originalLine
          comments(first: 50) { nodes { databaseId author { login } body createdAt url diffHunk } }
        }
      }
      comments(last: 50) { nodes { databaseId author { login } body createdAt url } }
    }
  }
}`;

type GqlComment = { databaseId: number; author: { login: string } | null; body: string; createdAt: string; url: string; diffHunk?: string };
const comment = (c: GqlComment): ThreadComment => ({ id: c.databaseId, author: c.author?.login ?? "ghost", body: c.body, at: c.createdAt, url: c.url });

export async function prDiscussion(url: string): Promise<Discussion> {
  const m = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)$/);
  if (!m) throw new Error("That isn't a GitHub PR link.");
  const r = await gh(["api", "graphql", "-f", `query=${QUERY}`, "-F", `owner=${m[1]}`, "-F", `name=${m[2]}`, "-F", `n=${m[3]}`]);
  if (!r.ok) throw new Error(r.err.slice(0, 300) || "Couldn't read the PR's comments.");
  const pr = JSON.parse(r.out)?.data?.repository?.pullRequest;
  if (!pr) throw new Error("Couldn't find that PR.");
  const threads: ReviewThread[] = (pr.reviewThreads?.nodes ?? []).map(
    (t: { id: string; isResolved: boolean; isOutdated: boolean; path: string; line: number | null; originalLine: number | null; comments: { nodes: GqlComment[] } }) => ({
      id: t.id,
      file: t.path,
      line: t.line ?? t.originalLine ?? null,
      resolved: t.isResolved,
      outdated: t.isOutdated,
      diffHunk: t.comments.nodes[0]?.diffHunk ?? "",
      comments: t.comments.nodes.map(comment),
    }),
  );
  return { threads, conversation: (pr.comments?.nodes ?? []).map(comment) };
}

// ── Claude's take: the latest review result for a PR ──

export interface Take {
  sessionId: string;
  headSha: string;
  at: string;
  result: ReviewResult;
}

const TAIL = 4 * 1024 * 1024; // the result is at the end of the session
const takeCache = new Map<string, { mtimeMs: number; size: number; result: ReviewResult | null }>();

// The last review result in a session file, read from its tail only (a session can be
// big, and this runs each time a PR's page opens). Cached by the file's size and time.
async function resultInSession(sessionId: string): Promise<ReviewResult | null> {
  const found = await findSessionFile(sessionId);
  if (!found) return null;
  const stat = await fs.stat(found.file);
  const hit = takeCache.get(found.file);
  if (hit && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.result;
  const from = Math.max(0, stat.size - TAIL);
  const buf = Buffer.alloc(stat.size - from);
  const fh = await fs.open(found.file, "r");
  try {
    await fh.read(buf, 0, buf.length, from);
  } finally {
    await fh.close();
  }
  let result: ReviewResult | null = null;
  const lines = buf.toString("utf8").split("\n");
  for (let i = lines.length - 1; i >= 0 && !result; i--) {
    if (!lines[i].includes("```json")) continue;
    try {
      const e = JSON.parse(lines[i]);
      if (e.type !== "assistant") continue;
      const content = e.message?.content;
      const text = typeof content === "string" ? content : Array.isArray(content) ? content.map((b: { type: string; text?: string }) => (b.type === "text" ? (b.text ?? "") : "")).join("\n") : "";
      const r = parseResult(text);
      if (r?.kind === "review") result = r;
    } catch {}
  }
  takeCache.set(found.file, { mtimeMs: stat.mtimeMs, size: stat.size, result });
  if (takeCache.size > 50) takeCache.delete(takeCache.keys().next().value!);
  return result;
}

export async function latestTake(url: string): Promise<Take | null> {
  if (!isPrUrl(url)) throw new Error("That isn't a GitHub PR link.");
  const { runs } = await recordsFor(url);
  for (const run of [...runs].reverse()) {
    const result = await resultInSession(run.sessionId).catch(() => null);
    if (result) return { sessionId: run.sessionId, headSha: run.headSha, at: run.at, result };
  }
  return null;
}
