import { execFile } from "node:child_process";
import { logActivity } from "@/lib/autopilot";
import { gh } from "@/lib/github";
import { isPrUrl } from "@/lib/reviewRecords";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The Discussion tab's GitHub actions, each only when you click it, from YOUR account
// (your own gh): reply to a review thread, resolve or unresolve it, or leave a comment
// on the PR, or approve it. The text is yours, posted as you wrote it. Approve is only
// ever your own click: Autopilot never approves.

type Body = { action?: string; url?: string; commentId?: number; threadId?: string; body?: string };

// gh with the text on stdin, so nothing in it is read as a flag.
function ghIn(args: string[], input: string): Promise<{ ok: boolean; out: string; err: string }> {
  return new Promise((resolve) => {
    const child = execFile("gh", args, { timeout: 30_000 }, (e, out, err) => resolve({ ok: !e, out: String(out), err: String(err || e?.message || "") }));
    child.stdin?.end(input);
  });
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const url = String(b.url ?? "");
  const m = url.match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)$/);
  if (!isPrUrl(url) || !m) return Response.json({ error: "Which PR?" }, { status: 400 });
  const [, repo, number] = m;
  const text = String(b.body ?? "").trim();

  if (b.action === "reply") {
    const id = Number(b.commentId);
    if (!(id > 0) || !text) return Response.json({ error: "Expected the comment to reply to, and some text." }, { status: 400 });
    const r = await ghIn(["api", "-X", "POST", `repos/${repo}/pulls/${number}/comments/${id}/replies`, "--input", "-", "--jq", ".html_url"], JSON.stringify({ body: text }));
    if (!r.ok) return Response.json({ error: `GitHub didn't take it: ${r.err.slice(0, 300)}` }, { status: 502 });
    await logActivity({ kind: "posted", url, detail: "You replied on a review thread" });
    return Response.json({ ok: true, url: r.out.trim() });
  }

  if (b.action === "resolve" || b.action === "unresolve") {
    const threadId = String(b.threadId ?? "");
    if (!/^[\w=-]{4,100}$/.test(threadId)) return Response.json({ error: "Which thread?" }, { status: 400 });
    const op = b.action === "resolve" ? "resolveReviewThread" : "unresolveReviewThread";
    const r = await gh(["api", "graphql", "-f", `query=mutation($id: ID!) { ${op}(input: {threadId: $id}) { thread { isResolved } } }`, "-F", `id=${threadId}`]);
    if (!r.ok) return Response.json({ error: `GitHub didn't take it: ${r.err.slice(0, 300)}` }, { status: 502 });
    return Response.json({ ok: true, resolved: b.action === "resolve" });
  }

  if (b.action === "comment") {
    if (!text) return Response.json({ error: "Write something first." }, { status: 400 });
    const r = await ghIn(["pr", "comment", url, "--body-file", "-"], text);
    if (!r.ok) return Response.json({ error: `GitHub didn't take it: ${r.err.slice(0, 300)}` }, { status: 502 });
    await logActivity({ kind: "posted", url, detail: "You commented on the PR" });
    return Response.json({ ok: true, url: r.out.trim() });
  }

  if (b.action === "approve") {
    // The comment box's text, if any, goes out as the approval's message.
    const r = text ? await ghIn(["pr", "review", url, "--approve", "--body-file", "-"], text) : await gh(["pr", "review", url, "--approve"]);
    if (!r.ok) return Response.json({ error: `GitHub didn't take it: ${r.err.slice(0, 300)}` }, { status: 502 });
    await logActivity({ kind: "posted", url, detail: "You approved the PR" });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Expected reply, resolve, unresolve, comment or approve." }, { status: 400 });
}
