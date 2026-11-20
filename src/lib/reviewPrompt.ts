import type { Risk } from "./risk";
import type { Finding } from "./reviewResult";
import type { PrSummary } from "./types";

// What Claude is asked to do on a PR, shared by the Review buttons (ReviewView.tsx) and
// the auto re-review (reviewWatchRunner.ts). Reviews post nothing (you post from the
// results panel or the Discussion tab); addressing your own PR may edit files.

export type Depth = "quick" | "standard" | "deep";

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

// useSkill: the lens:review skill is installed (Vendasta dev-agent toolkit) and switched
// on in Settings. Without it Claude reviews with gh and the local code instead of
// looking for a skill that isn't there.
// followUp: the PR was reviewed before at another commit, so this is a follow-up review
// (see below), not a second full one.
export function reviewPrompt(p: PrSummary, hasClone: boolean, risk?: Risk, depth: Depth = "standard", useSkill = true, followUp?: FollowUp) {
  if (followUp) return followUpPrompt(p, hasClone, followUp, risk);
  return [
    `Review pull request #${p.number} in ${p.repo}: ${p.url}`,
    "",
    hasClone && useSkill
      ? "Use the lens:review skill in its PR Studio mode: run Steps 1 to 7 on this repo (its `.claude/review.md` overlay applies), and post nothing. If that skill isn't available, review it with gh pr diff and the code in this folder instead. Never post, approve, comment or push on GitHub."
      : hasClone
        ? "Read it with the gh CLI (gh pr view, gh pr diff) and check the changes against the code in this folder. Look for real bugs and risks first. Never post, approve, comment or push on GitHub."
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

// ── Follow-up reviews: the review loop has to converge ──
// A second full review always finds something new (another nit, another question), so
// the author fixes, Claude reviews again, and it never ends. A follow-up only checks the
// earlier asks and the new commits, drops nits, and says when the PR is ready.

export interface FollowUp {
  sha: string; // the commit the last review read
  earlier: Finding[]; // that review's findings
}

const FOLLOW_UP_JSON =
  'Also add "ready": true to the JSON when every earlier blocker and should is fixed and you found no new blocker or should; else "ready": false. When it is ready, say so in the summary\'s first sentence.';

function followUpRules(sha: string, head: string) {
  return [
    `This is a follow-up review. The PR was reviewed at ${sha.slice(0, 7)} and is now at ${head.slice(0, 7) || "a newer commit"}. Don't review the whole PR again.`,
    '1. Check each earlier ask (the last review\'s findings and the earlier inline comments) against the code now, and put it in "priorChecks": fixed, unfixed or unverified. A finding from the last review has no commentId: give its file and line instead.',
    "2. New findings only on lines the new commits added or changed. The one exception is a blocker (it breaks something real), which you may raise anywhere.",
    "3. Only blocker or should. No nits, no style, no questions about code the new commits didn't touch.",
    "4. Don't raise again what the author already answered or chose not to change, unless it's a blocker.",
  ].join("\n");
}

export function earlierFindings(earlier: Finding[]) {
  if (!earlier.length) return "The last review had no findings.";
  return ["The last review's findings:", ...earlier.slice(0, 40).map((f, i) => `${i + 1}. [${f.severity ?? "should"}] ${f.file}:${f.line}: ${f.body.replace(/\s+/g, " ").slice(0, 400)}`)].join("\n");
}

function followUpPrompt(p: PrSummary, hasClone: boolean, f: FollowUp, risk?: Risk) {
  return [
    `Follow-up review of pull request #${p.number} in ${p.repo}: ${p.url}`,
    "",
    `See only what changed since the last review: \`gh api -H "Accept: application/vnd.github.diff" repos/${p.repo}/compare/${f.sha}...${p.headSha || p.head}\`. If that fails (the branch was force-pushed or rebased), read \`gh pr diff ${p.number} --repo ${p.repo}\` and judge what changed from the earlier findings.`,
    hasClone ? "Check the changes against the code in this folder (it may be on another branch). Never post, approve, comment or push on GitHub." : "Never post, approve, comment or push on GitHub.",
    "",
    followUpRules(f.sha, p.headSha),
    "",
    earlierFindings(f.earlier),
    "",
    priorCommentsStep(p),
    ...(risk ? [riskStep(risk)] : []),
    "",
    RESULT_JSON,
    FOLLOW_UP_JSON,
  ].join("\n");
}

// The auto re-review (reviewWatchRunner.ts). Claude can only read files here (no shell,
// no network), so the runner saves what it needs first. A follow-up when the PR was
// reviewed before, else a first review.
export function autoReviewPrompt(p: PrSummary, o: { dir: string; hasClone: boolean; risk: Risk; followUp: { sha: string; hasNewPatch: boolean } | null }) {
  const f = o.followUp;
  return [
    `${f ? "Follow-up review of" : "Review"} pull request #${p.number} in ${p.repo}: "${p.title}" by @${p.author}.`,
    "",
    "You can only read files: there is no shell and no network. Everything you need is saved for you:",
    `- ${o.dir}/pr.md: title, branches, description and the changed files`,
    `- ${o.dir}/diff.patch: the PR's full diff`,
    ...(f?.hasNewPatch ? [`- ${o.dir}/new.patch: only what changed since the last review (${f.sha.slice(0, 7)})`] : []),
    ...(f ? [`- ${o.dir}/earlier.md: the last review's findings`] : []),
    `- ${o.dir}/comments.json: earlier inline review comments (id, path, line, user, body, in_reply_to_id)`,
    o.hasClone
      ? "The repo is checked out in the current folder, maybe on another branch. Read it for context around the change (callers, types, tests); the diff is what the PR changes."
      : "There is no local copy of the repo, so review from the diff.",
    "",
    ...(f
      ? [
          followUpRules(f.sha, p.headSha),
          ...(f.hasNewPatch ? [] : ["new.patch couldn't be made (the branch was force-pushed or rebased): judge what changed from diff.patch and the earlier findings."]),
          "Earlier inline comments: each top-level one (no in_reply_to_id) that asks for a change goes in priorChecks, with its id as commentId.",
        ]
      : [
          DEPTH_ASK.standard,
          'For each top-level earlier comment (no in_reply_to_id) that asks for a change, check the diff and put it in "priorChecks": fixed (cite the code), unfixed, or unverified. Use its id as commentId. Don\'t repeat an earlier comment as a new finding.',
        ]),
    riskStep(o.risk),
    "",
    "Post nothing anywhere. Never approve.",
    RESULT_JSON,
    ...(f ? [FOLLOW_UP_JSON] : []),
  ].join("\n");
}
