import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { autopilotState, handedAlready, logActivity, markHanded, setFailed } from "./autopilot";
import { type AutopilotRules, type AutopilotState, type Depth, planFor, type Workflow } from "./autopilotPlan";
import { runner } from "./autopilotStatus";
import { gh, reviewBoard } from "./github";
import { trackRun } from "./lensRuns";
import { DATA_DIR } from "./paths";
import { setStateLabel } from "./prLabelsGh";
import { postReview, reviewHeader } from "./postReview";
import { autopilotPrompt } from "./reviewPrompt";
import { prSnapshot, recordPost, recordRun, recordsFor } from "./reviewRecords";
import { parseResult } from "./reviewResult";
import { riskOf } from "./risk";
import type { PrSummary } from "./types";

// The autopilot runner: every minute it checks whether it's time to look for work
// (your interval), picks the next PR from the queue (the first matching workflow wins,
// within your daily cap), and reviews it with Claude, one at a time.
//
// Locked down: before Claude starts, Vlens saves the PR, its diff and its earlier
// comments to a folder. Claude then gets only Read, Grep and Glob (no shell, no MCP,
// no network) in dontAsk mode, so it can't post, push or run anything, and it never
// stops on a permission prompt. Posting, when a workflow says so, is done here, from
// the review's JSON: COMMENT or REQUEST_CHANGES, never an approval.

const TICK_MS = 60_000;
const RUN_TIMEOUT_MS = 20 * 60_000;
const RUNS_DIR = path.join(DATA_DIR, "autopilot-runs");
const EFFORT: Record<Depth, string> = { quick: "low", standard: "medium", deep: "high" };

// Starts the once-a-minute check (idempotent; called by the autopilot API routes).
export function ensureRunner() {
  if (runner.timer) return;
  runner.timer = setInterval(() => void check(false), TICK_MS);
  setTimeout(() => void check(false), 5_000);
}

// Run now (force): look for work even if autopilot is off or it isn't time yet.
export async function check(force: boolean): Promise<string> {
  if (runner.running) return "A review is already running.";
  if (runner.busy) return "Already checking.";
  runner.busy = true;
  try {
    const s = await autopilotState();
    if (!force) {
      if (!s.rules.enabled) return "Autopilot is off.";
      const last = runner.lastCheck ? Date.parse(runner.lastCheck) : 0;
      if (Date.now() - last < s.rules.intervalMinutes * 60_000) return "Not time yet.";
    }
    runner.lastCheck = new Date().toISOString();
    const day = new Date().toDateString();
    if (s.today >= s.rules.dailyCap) {
      if (runner.capLogged !== day) {
        runner.capLogged = day;
        await logActivity({ kind: "skipped", detail: `Daily cap reached (${s.rules.dailyCap} reviews). Autopilot waits until tomorrow.` });
      }
      return "Daily cap reached.";
    }
    const board = await reviewBoard(false);
    if (board.error && !board.prs.length) return board.error;
    const pick = await nextPr(board.prs, s);
    if (!pick) return "Nothing in the queue.";
    void review(pick.pr, pick.wf, s.rules, board.clones[pick.pr.repo.toLowerCase()] ?? null);
    return `Reviewing ${pick.pr.repo} #${pick.pr.number}.`;
  } catch (e) {
    await logActivity({ kind: "error", detail: `Autopilot couldn't check for work: ${(e as Error).message.slice(0, 200)}` });
    return (e as Error).message;
  } finally {
    runner.busy = false;
  }
}

// The queue, in the board's order: re-checks of reviewed PRs first, then new ones;
// within each, by workflow order, then the most recently updated. Hand-offs are logged.
async function nextPr(prs: PrSummary[], s: AutopilotState): Promise<{ pr: PrSummary; wf: Workflow } | null> {
  const order = (id?: string) => s.rules.workflows.findIndex((w) => w.id === id);
  const cands: { pr: PrSummary; wf: Workflow; changed: boolean }[] = [];
  for (const pr of prs) {
    const plan = planFor(pr, s);
    if (plan.state === "handoff" && !(await handedAlready(pr.url, pr.headSha))) {
      await markHanded(pr.url, pr.headSha);
      await logActivity({ kind: "handed", url: pr.url, title: pr.title, detail: `Handed to you: ${plan.why}` });
      await label(pr, "handed", s.rules);
    }
    const wf = s.rules.workflows.find((w) => w.id === plan.workflow?.id);
    if (!wf) continue;
    if (s.failed[pr.url]?.headSha === pr.headSha) continue; // failed here before: you retry it
    if (plan.state === "queued" || (plan.state === "changed" && wf.recheck)) cands.push({ pr, wf, changed: plan.state === "changed" });
  }
  cands.sort((a, b) => Number(b.changed) - Number(a.changed) || order(a.wf.id) - order(b.wf.id) || b.pr.updatedAt.localeCompare(a.pr.updatedAt));
  return cands[0] ?? null;
}

const step = (text: string) => {
  if (!runner.running) return;
  const last = runner.running.steps.at(-1);
  if (last?.text === text) return;
  runner.running.steps.push({ at: new Date().toISOString(), text });
  if (runner.running.steps.length > 40) runner.running.steps.shift();
};

async function review(pr: PrSummary, wf: Workflow, rules: AutopilotRules, clone: string | null) {
  const startedAt = new Date().toISOString();
  runner.running = { url: pr.url, title: pr.title, headSha: pr.headSha, workflow: wf.name, startedAt, sessionId: null, steps: [] };
  const fail = async (error: string) => {
    await setFailed(pr.url, { headSha: pr.headSha, at: new Date().toISOString(), error, title: pr.title });
    await logActivity({ kind: "error", url: pr.url, title: pr.title, detail: `Review failed: ${error}` });
  };
  try {
    step("Read the PR from GitHub");
    const snap = await prSnapshot(pr.url, true);
    // A rebase or a merge from the base branch: same changes, so the last review stands.
    const last = (await recordsFor(pr.url)).runs.at(-1);
    if (last && last.headSha !== snap.headSha && last.diffHash === snap.diffHash) {
      await recordRun(pr.url, { ...last, headSha: snap.headSha, at: new Date().toISOString(), carried: true });
      await logActivity({ kind: "skipped", url: pr.url, title: pr.title, detail: `Same changes as the review at ${last.headSha.slice(0, 7)} (a rebase), so that review still stands` });
      return;
    }
    const dir = await prefetch(pr, snap.headSha);
    step("Saved the diff and earlier comments");
    const risk = riskOf(pr, rules.sensitivePaths);
    const prompt = autopilotPrompt(pr, { dir, hasClone: !!clone, risk, depth: wf.depth, handoffNotes: rules.handoffNotes });
    const out = await runClaude(prompt, clone ?? dir, dir, wf.depth);
    if (!out.ok) return await fail(out.error);
    const result = parseResult(out.text);
    if (result?.kind !== "review") return await fail("Claude finished without a review result.");
    await recordRun(pr.url, { sessionId: out.sessionId, headSha: snap.headSha, diffHash: snap.diffHash, at: startedAt, by: "autopilot" });
    await setFailed(pr.url, null);
    const n = result.findings.length;
    const adj = result.risk?.adjust ? ` · risk ${risk.score} → ${Math.max(0, Math.min(100, risk.score + result.risk.adjust))}` : "";
    if (result.handoff) {
      await logActivity({ kind: "handed", url: pr.url, title: pr.title, detail: `Reviewed, then handed to you: ${result.handoff}` });
      await label(pr, "handed", rules);
      return;
    }
    if (wf.then !== "private") await label(pr, "reviewed", rules); // "for me only" stays off GitHub
    if (wf.then === "comment" && (n || result.summary)) {
      step("Posting the review");
      const r = await postReview({
        repo: pr.repo,
        number: pr.number,
        sha: snap.headSha,
        event: result.verdict === "REQUEST_CHANGES" ? "REQUEST_CHANGES" : "COMMENT",
        body: `${await reviewHeader(true)}\n\n${result.summary}`.trim(),
        comments: result.findings.filter((f) => f.line > 0).map((f) => ({ path: f.file, line: f.line, body: f.body })),
      });
      await recordPost(pr.url, { sessionId: out.sessionId, key: null, headSha: snap.headSha, diffHash: snap.diffHash, url: r.url, event: result.verdict, inline: r.inline, at: new Date().toISOString() });
      await logActivity({ kind: "posted", url: pr.url, title: pr.title, detail: `Autopilot posted ${n} finding${n === 1 ? "" : "s"} (${wf.name})${adj}` });
      return;
    }
    await logActivity({
      kind: "reviewed",
      url: pr.url,
      title: pr.title,
      detail: `Autopilot reviewed at ${snap.headSha.slice(0, 7)}: ${n} finding${n === 1 ? "" : "s"}, ${wf.then === "private" ? "for you only" : "drafts for you to post"}${adj}`,
    });
  } catch (e) {
    await fail((e as Error).message.slice(0, 300));
  } finally {
    runner.running = null;
  }
}

// The state label on GitHub, when you switched them on. A failure is logged, and the
// review stands.
async function label(pr: PrSummary, state: "reviewed" | "handed", rules: AutopilotRules) {
  if (!rules.stateLabels.enabled) return;
  try {
    await setStateLabel(pr, state, rules.stateLabels);
  } catch (e) {
    await logActivity({ kind: "error", url: pr.url, title: pr.title, detail: `Couldn't set the ${state} label: ${(e as Error).message}` });
  }
}

// Everything the review needs, saved where Claude may read it.
async function prefetch(pr: PrSummary, sha: string): Promise<string> {
  const dir = path.join(RUNS_DIR, `${pr.repo.replace("/", "_")}-${pr.number}-${sha.slice(0, 7)}`);
  await fs.mkdir(dir, { recursive: true });
  const [view, diff, comments] = await Promise.all([
    gh(["pr", "view", pr.url, "--json", "title,body,author,headRefName,baseRefName,files"]),
    gh(["pr", "diff", pr.url], 60_000),
    gh(["api", `repos/${pr.repo}/pulls/${pr.number}/comments`, "--paginate", "--jq", "[.[] | {id, path, line, user: .user.login, body, in_reply_to_id}]"], 30_000),
  ]);
  if (!view.ok || !diff.ok) throw new Error((view.err || diff.err).slice(0, 200) || "Couldn't read the PR.");
  const v = JSON.parse(view.out);
  const md = [
    `# ${v.title}`,
    "",
    `${pr.repo} #${pr.number} by @${v.author?.login ?? pr.author} · ${v.headRefName} → ${v.baseRefName} · head ${sha}`,
    "",
    "## Description",
    "",
    v.body?.trim() || "(none)",
    "",
    "## Changed files",
    "",
    ...(v.files ?? []).map((f: { path: string; additions: number; deletions: number }) => `- ${f.path} (+${f.additions} −${f.deletions})`),
  ].join("\n");
  // --paginate prints one JSON array per page.
  const all = comments.ok ? comments.out.trim().split(/\n(?=\[)/).flatMap((x) => { try { return JSON.parse(x); } catch { return []; } }) : [];
  await Promise.all([fs.writeFile(path.join(dir, "pr.md"), md), fs.writeFile(path.join(dir, "diff.patch"), diff.out), fs.writeFile(path.join(dir, "comments.json"), JSON.stringify(all, null, 1))]);
  await prune();
  return dir;
}

// Keep the last 30 run folders.
async function prune() {
  const names = await fs.readdir(RUNS_DIR).catch(() => [] as string[]);
  if (names.length <= 30) return;
  const dated = await Promise.all(names.map(async (n) => ({ n, t: (await fs.stat(path.join(RUNS_DIR, n)).catch(() => null))?.mtimeMs ?? 0 })));
  for (const { n } of dated.sort((a, b) => a.t - b.t).slice(0, names.length - 30)) await fs.rm(path.join(RUNS_DIR, n), { recursive: true, force: true });
}

const short = (p: string) => p.split("/").slice(-2).join("/");

// One locked-down `claude -p`: read-only tools, no MCP, nothing to approve.
function runClaude(prompt: string, cwd: string, dir: string, depth: Depth): Promise<{ ok: true; text: string; sessionId: string } | { ok: false; error: string }> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--tools", "Read,Grep,Glob", "--permission-mode", "dontAsk", "--strict-mcp-config", "--add-dir", dir, "--effort", EFFORT[depth]];
  return new Promise((resolve) => {
    const child = spawn("claude", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    trackRun(child);
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
    let buf = "";
    let stderr = "";
    let result: { is_error?: boolean; result?: string } | null = null;
    let sessionId = "";
    let stopped = false;
    child.stdout.on("data", (c: Buffer) => {
      buf += c.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const ev = JSON.parse(line);
          if (ev.session_id && !sessionId) {
            sessionId = ev.session_id;
            if (runner.running) runner.running.sessionId = sessionId;
          }
          if (ev.type === "assistant")
            for (const b of ev.message?.content ?? []) {
              if (b.type === "tool_use") {
                const i = b.input ?? {};
                if (b.name === "Read") step(`Read ${short(String(i.file_path ?? ""))}`);
                else if (b.name === "Grep") step(`Searched for "${String(i.pattern ?? "").slice(0, 40)}"`);
                else if (b.name === "Glob") step(`Listed ${String(i.pattern ?? "")}`);
              } else if (b.type === "text" && String(b.text).includes("```json")) step("Writing the review");
            }
          if (ev.type === "result") result = ev;
        } catch {}
      }
    });
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    const timer = setTimeout(() => {
      stopped = true;
      child.kill("SIGTERM");
    }, RUN_TIMEOUT_MS);
    if (runner.running)
      runner.running.kill = () => {
        stopped = true;
        child.kill("SIGTERM");
      };
    child.on("close", () => {
      clearTimeout(timer);
      if (result && !result.is_error && sessionId) resolve({ ok: true, text: String(result.result ?? ""), sessionId });
      else resolve({ ok: false, error: stopped ? "Stopped." : String(result?.result || stderr.trim() || "Claude didn't finish.").slice(0, 300) });
    });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
  });
}

// Stop: end the running review. It counts as failed at this commit, so it isn't
// picked again until you retry it or the PR moves on.
export function stopRun(): boolean {
  if (!runner.running?.kill) return false;
  runner.running.kill();
  return true;
}

