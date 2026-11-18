import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logActivity } from "@/lib/autopilot";
import { prSnapshot, recordPost, recordsFor } from "@/lib/reviewRecords";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Post review as me": the findings you kept from Review with Claude, posted as one
// GitHub review from YOUR account (your own gh), with each finding inline at its
// line. Only when you press the button. If GitHub can't place a finding on the diff,
// the review goes out with the findings in its body instead, and says so.
//
// A review is checked against the commit it read (see reviewRecords.ts): if the PR
// has new commits since, Post answers 409 and you choose. "Post anyway" pins the
// review to the commit it read, so every finding still lands on the right line.

const run = promisify(execFile);
type Comment = { path: string; line: number; body: string };

let name: string | null = null;
async function myName() {
  if (name === null) name = (await run("gh", ["api", "user", "--jq", ".name // .login"], { timeout: 15_000 }).then((r) => r.stdout.trim().split(/\s+/)[0], () => "")) || "My";
  return name;
}

function ghReview(repo: string, number: number, payload: object) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile("gh", ["api", "-X", "POST", `repos/${repo}/pulls/${number}/reviews`, "--input", "-", "--jq", ".html_url"], { timeout: 60_000 }, (e, out, err) =>
      e ? reject(new Error((err || e.message).trim().slice(0, 400))) : resolve(out.trim()),
    );
    child.stdin?.end(JSON.stringify(payload));
  });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { repo?: string; number?: number; event?: string; body?: string; comments?: Comment[]; sessionId?: string; key?: string; force?: boolean };
  const repo = String(b.repo ?? "");
  const number = Number(b.number);
  const event = String(b.event ?? "COMMENT");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !(number > 0)) return Response.json({ error: "Which PR? Expected owner/name and a number." }, { status: 400 });
  if (!["COMMENT", "REQUEST_CHANGES"].includes(event)) return Response.json({ error: "event should be COMMENT or REQUEST_CHANGES (Vlens never approves for you)." }, { status: 400 });
  const comments = (Array.isArray(b.comments) ? b.comments : [])
    .filter((c) => c && typeof c.path === "string" && Number(c.line) > 0 && String(c.body ?? "").trim())
    .map((c) => ({ path: c.path, line: Math.round(Number(c.line)), side: "RIGHT", body: String(c.body).trim() }));
  const head = `🤖 **${await myName()}'s agent** says:`;
  const text = [head, String(b.body ?? "").trim()].filter(Boolean).join("\n\n");
  if (!comments.length && text === head) return Response.json({ error: "Nothing to post: keep at least one finding, or write a summary." }, { status: 400 });
  const prUrl = `https://github.com/${repo}/pull/${number}`;
  const sessionId = typeof b.sessionId === "string" ? b.sessionId : null;
  try {
    const now = await prSnapshot(prUrl, true);
    // The commit this review read, when Vlens saw it start.
    const reviewed = sessionId ? (await recordsFor(prUrl)).runs.find((r) => r.sessionId === sessionId) : undefined;
    const moved = !!reviewed && reviewed.headSha !== now.headSha;
    if (moved && !b.force)
      return Response.json(
        { error: "The PR changed since this review.", moved: true, sameDiff: reviewed.diffHash === now.diffHash, reviewedSha: reviewed.headSha, currentSha: now.headSha },
        { status: 409 },
      );
    const sha = moved ? reviewed.headSha : now.headSha;
    const done = async (url: string, inline: number, note?: string) => {
      await logActivity({ kind: "posted", url: prUrl, detail: `You posted a ${event === "REQUEST_CHANGES" ? "request-changes" : "comment"} review with ${inline} inline finding${inline === 1 ? "" : "s"}${moved ? ` on ${sha.slice(0, 7)} (the commit it read)` : ""}` });
      await recordPost(prUrl, { sessionId, key: typeof b.key === "string" ? b.key : null, headSha: sha, diffHash: moved ? reviewed.diffHash : now.diffHash, url, event, inline, at: new Date().toISOString() });
      return Response.json({ ok: true, url, inline, note });
    };
    try {
      return await done(await ghReview(repo, number, { commit_id: sha, event, body: text, comments }), comments.length);
    } catch (e) {
      if (!comments.length) throw e;
      // A line GitHub can't place on the diff fails the whole review: fold them into the body.
      const folded = `${text}\n\n${comments.map((c, i) => `${i + 1}. **${c.path}:${c.line}**: ${c.body}`).join("\n\n")}`;
      return await done(await ghReview(repo, number, { commit_id: sha, event, body: folded }), 0, `GitHub couldn't place the findings on the diff (${(e as Error).message.slice(0, 120)}), so they're in the review's text instead.`);
    }
  } catch (e) {
    return Response.json({ error: `GitHub didn't take it: ${(e as Error).message}` }, { status: 502 });
  }
}
