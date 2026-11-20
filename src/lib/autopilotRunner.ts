import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { autopilotState, handedAlready, logActivity, markHanded, setFailed } from "./autopilot";
import { type AutopilotRules, type AutopilotState, type Depth, planFor, type Workflow } from "./autopilotPlan";
import { type Run, runner } from "./autopilotStatus";
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

// The autopilot runner, a worker pool: every minute it checks whether it's time to look
// for work (your interval), then fills each free worker (up to `workers` at once) with
// the next PR from the queue (the first matching workflow wins). There's no daily limit:
// the number of workers is the only throttle.
// When a worker finishes, it takes the next PR straight away, so the queue drains
// without waiting for the next interval.
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
const LOCK = path.join(DATA_DIR, "autopilot.lock");
const LOCK_STALE_MS = 3 * 60_000;

// Only one Vlens on this Mac runs autopilot (the dev server and the app share the
// data folder). The holder refreshes the lock every tick; a lock nobody refreshed
// for a few minutes, or whose process is gone, is taken over.
async function holdLock(): Promise<boolean> {
  try {
    const l = JSON.parse(await fs.readFile(LOCK, "utf8")) as { pid: number; at: number };
    if (l.pid !== process.pid && Date.now() - l.at < LOCK_STALE_MS) {
      let alive = true;
      try {
        process.kill(l.pid, 0);
      } catch {
        alive = false;
      }
      if (alive) return false;
    }
  } catch {
    /* no lock yet, or unreadable: take it */
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${LOCK}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ pid: process.pid, at: Date.now() }));
  await fs.rename(tmp, LOCK);
  return true;
}

// Never post anything that looks like a credential, whatever the PR asked for.
const SECRET = /(-----BEGIN [A-Z ]*PRIVATE KEY-----|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bxox[abprs]-[A-Za-z0-9-]{10,}|\bsk-(ant-)?[A-Za-z0-9_-]{20,}|\bAIza[0-9A-Za-z_-]{35}\b)/;

// Starts the once-a-minute check (idempotent; called by the autopilot API routes).
export function ensureRunner() {
  if (runner.timer) return;
  runner.timer = setInterval(() => void check(false), TICK_MS);
  setTimeout(() => void check(false), 5_000);
}

// Run now (force): look for work even if autopilot is off or it isn't time yet.
// refill: a worker just finished, so look again now (still only while autopilot is on).
export async function check(force: boolean, refill = false): Promise<string> {
  if (runner.busy) {
    if (refill) runner.again = true;
    return "Already checking.";
  }
  runner.busy = true;
  try {
    if (!(await holdLock())) return "Another Vlens on this Mac is running autopilot.";
    const s = await autopilotState();
    const free = s.rules.workers - runner.runs.size;
    if (free <= 0) return runner.runs.size === 1 ? "A review is already running." : `All ${s.rules.workers} workers are busy.`;
    if (!force) {
      if (!s.rules.enabled) return "Autopilot is off.";
      const last = runner.lastCheck ? Date.parse(runner.lastCheck) : 0;
      if (!refill && Date.now() - last < s.rules.intervalMinutes * 60_000) return "Not time yet.";
    }
    if (!refill) runner.lastCheck = new Date().toISOString();
    const board = await reviewBoard(false);
    if (board.error && !board.prs.length) return board.error;
    const picks = (await queue(board.prs, s)).filter((x) => !runner.runs.has(x.pr.url)).slice(0, free);
    if (!picks.length) return runner.runs.size ? "Nothing more in the queue." : "Nothing in the queue.";
    for (const { pr, wf } of picks) startReview(pr, wf, s.rules, board.clones[pr.repo.toLowerCase()] ?? null, force);
    return `Reviewing ${picks.map(({ pr }) => `${pr.repo.split("/")[1]} #${pr.number}`).join(", ")}.`;
  } catch (e) {
    await logActivity({ kind: "error", detail: `Autopilot couldn't check for work: ${(e as Error).message.slice(0, 200)}` });
    return (e as Error).message;
  } finally {
    runner.busy = false;
    if (runner.again) {
      runner.again = false;
      setTimeout(() => void check(false, true), 0);
    }
  }
}

// A worker takes the PR, and when it's done the pool looks for the next one.
function startReview(pr: PrSummary, wf: Workflow, rules: AutopilotRules, clone: string | null, forced: boolean) {
  let cancelled = false;
  const run: Run = { url: pr.url, title: pr.title, headSha: pr.headSha, workflow: wf.name, startedAt: new Date().toISOString(), sessionId: null, steps: [], kill: () => (cancelled = true) };
  runner.runs.set(pr.url, run);
  void review(run, pr, wf, rules, clone, forced, () => cancelled).finally(() => {
    runner.runs.delete(pr.url);
    void check(false, true);
  });
}

// The queue, in the board's order: re-checks of reviewed PRs first, then new ones;
// within each, by workflow order, then the most recently updated. Hand-offs are logged.
async function queue(prs: PrSummary[], s: AutopilotState): Promise<{ pr: PrSummary; wf: Workflow }[]> {
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
  return cands;
}

// A line in this run's progress, shown on the board.
const stepOf = (run: Run) => (text: string) => {
  const last = run.steps.at(-1);
  if (last?.text === text) return;
  run.steps.push({ at: new Date().toISOString(), text });
  if (run.steps.length > 40) run.steps.shift();
};

async function review(run: Run, pr: PrSummary, wf: Workflow, rules: AutopilotRules, clone: string | null, forced: boolean, cancelled: () => boolean) {
  const startedAt = run.startedAt;
  const step = stepOf(run);
  const checkStop = () => {
    if (cancelled()) throw new Error("Stopped.");
  };
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
    checkStop();
    const dir = await prefetch(pr, snap.headSha);
    step("Saved the diff and earlier comments");
    checkStop();
    const risk = riskOf(pr, rules.sensitivePaths);
    const prompt = autopilotPrompt(pr, { dir, hasClone: !!clone, risk, depth: wf.depth, handoffNotes: rules.handoffNotes });
    const out = await runClaude(run, prompt, clone ?? dir, dir, wf.depth);
    if (!out.ok) return await fail(out.error);
    const result = parseResult(out.text);
    if (result?.kind !== "review") return await fail("Claude finished without a review result.");

    // The review can take minutes. If you paused this PR, turned autopilot off or
    // changed the workflow meanwhile, don't touch GitHub: keep it as a draft.
    const now = await autopilotState();
    const nowWf = now.rules.workflows.find((w) => w.id === wf.id);
    const held = now.paused[pr.url] ? "you paused this PR" : !forced && !now.rules.enabled ? "autopilot was turned off" : !nowWf ? `the "${wf.name}" workflow was removed` : nowWf.then !== wf.then ? `the "${wf.name}" workflow changed` : null;
    if (held) {
      rules = { ...rules, stateLabels: { ...rules.stateLabels, enabled: false } };
      if (wf.then === "comment") wf = { ...wf, then: "draft" };
    }
    const leak = SECRET.test(`${result.summary}\n${result.findings.map((f) => f.body).join("\n")}`);
    if (leak && wf.then === "comment") wf = { ...wf, then: "draft" };
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
    if (held || leak)
      await logActivity({ kind: "skipped", url: pr.url, title: pr.title, detail: `Not posted on GitHub: ${held ?? "the review text looks like it contains a secret"}. It's kept as drafts for you.` });
    await logActivity({
      kind: "reviewed",
      url: pr.url,
      title: pr.title,
      detail: `Autopilot reviewed at ${snap.headSha.slice(0, 7)}: ${n} finding${n === 1 ? "" : "s"}, ${wf.then === "private" ? "for you only" : "drafts for you to post"}${adj}`,
    });
  } catch (e) {
    await fail((e as Error).message.slice(0, 300));
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
function runClaude(run: Run, prompt: string, cwd: string, dir: string, depth: Depth): Promise<{ ok: true; text: string; sessionId: string } | { ok: false; error: string }> {
  const step = stepOf(run);
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--tools", "Read,Grep,Glob", "--disallowedTools", "Read(**/.env*)", "Read(**/*.pem)", "Read(**/*.key)", "--permission-mode", "dontAsk", "--strict-mcp-config", "--add-dir", dir, "--effort", EFFORT[depth]];
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
            run.sessionId = sessionId;
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
    child.stderr.on("data", (c: Buffer) => (stderr = (stderr + c.toString()).slice(-16_000)));
    const timer = setTimeout(() => {
      stopped = true;
      child.kill("SIGTERM");
    }, RUN_TIMEOUT_MS);
    const before = run.kill;
    run.kill = () => {
      before?.();
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

// Stop: end that PR's running review (or every one, with no url). It counts as failed
// at this commit, so it isn't picked again until you retry it or the PR moves on.
export function stopRun(url?: string): boolean {
  const runs = url ? [runner.runs.get(url)].filter((r): r is Run => !!r) : [...runner.runs.values()];
  for (const r of runs) r.kill?.();
  return runs.length > 0;
}

