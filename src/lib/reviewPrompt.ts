import type { Depth } from "./autopilotPlan";
import type { Risk } from "./risk";
import type { PrSummary } from "./types";

// What Claude is asked to do on a PR, shared by the Review buttons (ReviewView.tsx) and
// the autopilot runner (autopilotRunner.ts). Reviews post nothing (you post from the
// results panel, ReviewResults.tsx); addressing your own PR may edit files.

const RESULT_JSON = [
  "End your reply with the result as one ```json block, exactly this shape:",
  '{"verdict": "COMMENT | REQUEST_CHANGES", "summary": "two or three plain sentences for the review\'s top comment", "findings": [{"id": "1", "file": "path/in/repo.ts", "line": 42, "severity": "blocker | should | question | nit", "body": "what is wrong, why it matters, a suggested fix"}], "priorChecks": [{"commentId": 123456, "file": "path/in/repo.ts", "line": 40, "author": "login", "status": "fixed | unfixed | unverified", "evidence": "what in the code now shows it"}]}',
  "`line` is a line in the PR's new version of the file, inside the diff. Write each body as a reviewer's comment, kind and specific.",
  "Severity: blocker = breaks something real; should = worth fixing before merge; question = you aren't sure, ask; nit = small polish. A blocker or should must name the concrete case that triggers it and what goes wrong; if you can't, make it a question.",
  "One finding per root cause. Never approve: the verdict is COMMENT or REQUEST_CHANGES.",
].join("\n");

// Earlier inline review comments, so a re-review checks them instead of repeating them.
function priorCommentsStep(p: PrSummary) {
  return [
    `First read the earlier inline review comments: \`gh api repos/${p.repo}/pulls/${p.number}/comments --paginate\`. For each top-level one (no in_reply_to_id) that asks for a change, check the current code and put it in "priorChecks": fixed (cite the code that fixes it), unfixed, or unverified (can't tell from the code). Use the comment's id as commentId.`,
    "Don't add a new finding that repeats an earlier comment; it is covered by priorChecks.",
  ].join("\n");
}

// The deterministic risk score goes in, and Claude may move it by up to 20 points.
function riskStep(risk: Risk) {
  const why = risk.factors.length ? risk.factors.map((f) => `${f.points > 0 ? "+" : ""}${f.points} ${f.why}`).join("; ") : "nothing stood out";
  return [
    `Vlens scored this PR's risk at ${risk.score}/100 from its file list and size (${why}).`,
    'In the JSON add "risk": {"adjust": <a whole number from -20 to 20>, "why": "one plain sentence"}. Move it up when the code is riskier than those signals show (data loss, security, money, concurrency, a hard-to-undo change), down when it is safer (well tested, behind a flag, trivial). Use 0 when they are about right.',
  ].join("\n");
}

const DEPTH_ASK: Record<Depth, string> = {
  quick: "Look only for blockers: changes that break something real. Skip style, naming and nits.",
  standard: "Look for real bugs and risks first, then anything worth fixing before merge. Keep nits few.",
  deep: "Be thorough: edge cases, error handling, concurrency, security, data changes and missing tests. Still one finding per root cause.",
};

export function reviewPrompt(p: PrSummary, hasClone: boolean, risk?: Risk, depth: Depth = "standard") {
  return [
    `Review pull request #${p.number} in ${p.repo}: ${p.url}`,
    "",
    hasClone
      ? "Use the lens:review skill in its PR Studio mode: run Steps 1 to 7 on this repo (its `.claude/review.md` overlay applies), and post nothing. Never post, approve, comment or push on GitHub."
      : "Read it with the gh CLI (gh pr view, gh pr diff). Look for real bugs and risks first. Never post, approve, comment or push on GitHub.",
    "If the PR links a Jira ticket, check the change against its acceptance criteria and say which are met.",
    DEPTH_ASK[depth],
    priorCommentsStep(p),
    ...(risk ? [riskStep(risk)] : []),
    "",
    RESULT_JSON,
  ].join("\n");
}

// galaxy's own skill (.claude/skills/galaxy-before-after in your clone): screenshots of
// what the PR changes, from the builds Cloud Build already published.
export function beforeAfterPrompt(p: PrSummary) {
  return [
    `Use the galaxy-before-after skill to show what pull request #${p.number} changes on screen: ${p.url}`,
    "Pick the apps and routes from its changed files as the skill says. Save every screenshot as a PNG file under ~/galaxy-proof. Never post anything on GitHub.",
    "",
    "End your reply with one ```json block, exactly this shape (absolute file paths):",
    '{"verdict": "PASS | INCONCLUSIVE | BLOCKED", "summary": "what changed on screen, in two sentences", "shots": [{"label": "Business Center · /route · desktop light", "before": "/Users/.../before.png", "after": "/Users/.../after.png"}]}',
  ].join("\n");
}

export function addressPrompt(p: PrSummary) {
  return [
    `This is my pull request: ${p.url}`,
    "",
    `Check out its branch with \`gh pr checkout ${p.number}\`, then read the review comments and any failing checks with gh. Make the fixes and tell me what you changed. Don't push, and don't reply on GitHub, without asking me first.`,
  ].join("\n");
}



// The autopilot runner's review. Claude can only read files here (no shell, no network),
// so the runner saves what it needs first: the PR, its diff and its earlier comments.
export function autopilotPrompt(p: PrSummary, o: { dir: string; hasClone: boolean; risk: Risk; depth: Depth; handoffNotes: string }) {
  return [
    `Review pull request #${p.number} in ${p.repo}: "${p.title}" by @${p.author}.`,
    "",
    "You can only read files: there is no shell and no network. Everything you need is saved for you:",
    `- ${o.dir}/pr.md: title, branches, description and the changed files`,
    `- ${o.dir}/diff.patch: the full diff`,
    `- ${o.dir}/comments.json: earlier inline review comments (id, path, line, user, body, in_reply_to_id)`,
    o.hasClone
      ? "The repo is checked out in the current folder, maybe on another branch. Read it for context around the change (callers, types, tests); the diff is what the PR changes."
      : "There is no local copy of the repo, so review from the diff.",
    "",
    DEPTH_ASK[o.depth],
    'For each top-level earlier comment (no in_reply_to_id) that asks for a change, check the diff and put it in "priorChecks": fixed (cite the code), unfixed, or unverified. Use its id as commentId. Don\'t repeat an earlier comment as a new finding.',
    riskStep(o.risk),
    ...(o.handoffNotes.trim() ? ["", `The reviewer wants these PRs handed to them instead: ${o.handoffNotes.trim()}`, 'If this PR is one of them, add "handoff": "one sentence on why" to the JSON.'] : []),
    "",
    "Post nothing anywhere. Never approve.",
    RESULT_JSON,
  ].join("\n");
}
