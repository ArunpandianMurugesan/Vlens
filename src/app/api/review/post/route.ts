import { logActivity } from "@/lib/autopilot";
import { type ReviewComment, postReview, reviewHeader } from "@/lib/postReview";
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

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { repo?: string; number?: number; event?: string; body?: string; comments?: ReviewComment[]; sessionId?: string; key?: string; force?: boolean };
  const repo = String(b.repo ?? "");
  const number = Number(b.number);
  const event = String(b.event ?? "COMMENT");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !(number > 0)) return Response.json({ error: "Which PR? Expected owner/name and a number." }, { status: 400 });
  if (!["COMMENT", "REQUEST_CHANGES"].includes(event)) return Response.json({ error: "event should be COMMENT or REQUEST_CHANGES (Vlens never approves for you)." }, { status: 400 });
  const comments = (Array.isArray(b.comments) ? b.comments : [])
    .filter((c) => c && typeof c.path === "string" && Number(c.line) > 0 && String(c.body ?? "").trim())
    .map((c) => ({ path: c.path, line: Math.round(Number(c.line)), body: String(c.body).trim() }));
  if (!comments.length && !String(b.body ?? "").trim()) return Response.json({ error: "Nothing to post: keep at least one finding, or write a summary." }, { status: 400 });
  const prUrl = `https://github.com/${repo}/pull/${number}`;
  const sessionId = typeof b.sessionId === "string" ? b.sessionId : null;
  try {
    const now = await prSnapshot(prUrl, true);
    // The commit this review read, when Vlens saw it start (the newest run: one session
    // can hold several reviews).
    const reviewed = sessionId ? (await recordsFor(prUrl)).runs.findLast((r) => r.sessionId === sessionId) : undefined;
    const moved = !!reviewed && reviewed.headSha !== now.headSha;
    if (moved && !b.force)
      return Response.json(
        { error: "The PR changed since this review.", moved: true, sameDiff: reviewed.diffHash === now.diffHash, reviewedSha: reviewed.headSha, currentSha: now.headSha },
        { status: 409 },
      );
    const sha = moved ? reviewed.headSha : now.headSha;
    const r = await postReview({ repo, number, sha, event, body: `${await reviewHeader()}\n\n${String(b.body ?? "").trim()}`.trim(), comments });
    await logActivity({ kind: "posted", url: prUrl, detail: `You posted a ${event === "REQUEST_CHANGES" ? "request-changes" : "comment"} review with ${r.inline} inline finding${r.inline === 1 ? "" : "s"}${moved ? ` on ${sha.slice(0, 7)} (the commit it read)` : ""}` });
    await recordPost(prUrl, { sessionId, key: typeof b.key === "string" ? b.key : null, headSha: sha, diffHash: moved ? reviewed.diffHash : now.diffHash, url: r.url, event, inline: r.inline, at: new Date().toISOString() });
    return Response.json({ ok: true, url: r.url, inline: r.inline, note: r.note });
  } catch (e) {
    return Response.json({ error: `GitHub didn't take it: ${(e as Error).message}` }, { status: 502 });
  }
}
