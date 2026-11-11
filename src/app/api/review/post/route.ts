import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Post review as me": the findings you kept from Review with Claude, posted as one
// GitHub review from YOUR account (your own gh), with each finding inline at its
// line. Only when you press the button. If GitHub can't place a finding on the diff,
// the review goes out with the findings in its body instead, and says so.

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
  const b = (await req.json().catch(() => ({}))) as { repo?: string; number?: number; event?: string; body?: string; comments?: Comment[] };
  const repo = String(b.repo ?? "");
  const number = Number(b.number);
  const event = String(b.event ?? "COMMENT");
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !(number > 0)) return Response.json({ error: "Which PR? Expected owner/name and a number." }, { status: 400 });
  if (!["COMMENT", "REQUEST_CHANGES", "APPROVE"].includes(event)) return Response.json({ error: "event should be COMMENT, REQUEST_CHANGES or APPROVE." }, { status: 400 });
  const comments = (Array.isArray(b.comments) ? b.comments : [])
    .filter((c) => c && typeof c.path === "string" && Number(c.line) > 0 && String(c.body ?? "").trim())
    .map((c) => ({ path: c.path, line: Math.round(Number(c.line)), side: "RIGHT", body: String(c.body).trim() }));
  const head = `🤖 **${await myName()}'s agent** says:`;
  const text = [head, String(b.body ?? "").trim()].filter(Boolean).join("\n\n");
  if (!comments.length && text === head) return Response.json({ error: "Nothing to post: keep at least one finding, or write a summary." }, { status: 400 });
  try {
    const sha = (await run("gh", ["pr", "view", String(number), "-R", repo, "--json", "headRefOid", "--jq", ".headRefOid"], { timeout: 30_000 })).stdout.trim();
    try {
      const url = await ghReview(repo, number, { commit_id: sha, event, body: text, comments });
      return Response.json({ ok: true, url, inline: comments.length });
    } catch (e) {
      if (!comments.length) throw e;
      // A line GitHub can't place on the diff fails the whole review: fold them into the body.
      const folded = `${text}\n\n${comments.map((c, i) => `${i + 1}. **${c.path}:${c.line}**: ${c.body}`).join("\n\n")}`;
      const url = await ghReview(repo, number, { commit_id: sha, event, body: folded });
      return Response.json({ ok: true, url, inline: 0, note: `GitHub couldn't place the findings on the diff (${(e as Error).message.slice(0, 120)}), so they're in the review's text instead.` });
    }
  } catch (e) {
    return Response.json({ error: `GitHub didn't take it: ${(e as Error).message}` }, { status: 502 });
  }
}
