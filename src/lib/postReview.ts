import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// One GitHub review from YOUR account (your own gh), each finding inline at its line.
// Used by "Post review as me" (api/review/post) and by autopilot workflows set to post
// comments themselves. Only COMMENT or REQUEST_CHANGES: never an approval.

const run = promisify(execFile);
export type ReviewComment = { path: string; line: number; body: string };

let name: string | null = null;
async function myName() {
  if (name === null) name = (await run("gh", ["api", "user", "--jq", ".name // .login"], { timeout: 15_000 }).then((r) => r.stdout.trim().split(/\s+/)[0], () => "")) || "My";
  return name;
}
export const reviewHeader = async (autopilot = false) => `🤖 **${await myName()}'s agent**${autopilot ? " (autopilot)" : ""} says:`;

function ghReview(repo: string, number: number, payload: object) {
  return new Promise<string>((resolve, reject) => {
    const child = execFile("gh", ["api", "-X", "POST", `repos/${repo}/pulls/${number}/reviews`, "--input", "-", "--jq", ".html_url"], { timeout: 60_000 }, (e, out, err) =>
      e ? reject(new Error((err || e.message).trim().slice(0, 400))) : resolve(out.trim()),
    );
    child.stdin?.end(JSON.stringify(payload));
  });
}

// Posts on `sha` (the commit the review read). If GitHub can't place a finding on the
// diff, the review goes out with the findings in its body instead, and `note` says so.
export async function postReview(o: { repo: string; number: number; sha: string; event: string; body: string; comments: ReviewComment[] }): Promise<{ url: string; inline: number; note?: string }> {
  if (o.event !== "COMMENT" && o.event !== "REQUEST_CHANGES") throw new Error("Vlens never approves.");
  const comments = o.comments.map((c) => ({ path: c.path, line: c.line, side: "RIGHT", body: c.body }));
  try {
    return { url: await ghReview(o.repo, o.number, { commit_id: o.sha, event: o.event, body: o.body, comments }), inline: comments.length };
  } catch (e) {
    // Fold the findings into the body only when GitHub refused to place them (422).
    // After a timeout or network error the first review may already exist: posting
    // again would leave two reviews on the PR.
    if (!comments.length || !/HTTP 422|Unprocessable/i.test((e as Error).message)) throw e;
    const folded = `${o.body}\n\n${comments.map((c, i) => `${i + 1}. **${c.path}:${c.line}**: ${c.body}`).join("\n\n")}`;
    return { url: await ghReview(o.repo, o.number, { commit_id: o.sha, event: o.event, body: folded }), inline: 0, note: `GitHub couldn't place the findings on the diff (${(e as Error).message.slice(0, 120)}), so they're in the review's text instead.` };
  }
}
