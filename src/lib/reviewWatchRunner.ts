import "server-only";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { logActivity } from "./activity";
import { gh, reviewBoard } from "./github";
import { trackRun } from "./lensRuns";
import { DATA_DIR } from "./paths";
import { latestTake } from "./prDiscussion";
import { autoReviewPrompt, earlierFindings } from "./reviewPrompt";
import { allRecords, prSnapshot, recordRun, recordsFor } from "./reviewRecords";
import { parseResult } from "./reviewResult";
import { riskOf } from "./risk";
import { failedAt, type LiveRun, liveRuns, setFailed, watchList } from "./reviewWatch";
import type { PrSummary, ReviewBoard } from "./types";

// Auto re-review: for the PRs where you switched it on, Claude reviews new commits by
// itself and leaves the findings as drafts in the PR's Discussion tab. It never posts.
//
// There's no timer here. It runs when Vlens reads your PR board (the Review screen's
// refresh, every 10 minutes while Vlens is open, or the Refresh button) and a watched
// PR has a commit no review has read yet. A PR reviewed before gets a follow-up
// review (only the earlier asks and the new commits, see reviewPrompt.ts), so the
// review → fix → review loop converges instead of finding new nits every round.
//
// Locked down: Vlens saves the PR, its diffs and earlier comments to a folder first.
// Claude then gets only Read, Grep and Glob (no shell, no MCP, no network) in dontAsk
// mode, so it can't post, push or run anything, and never stops on a prompt.

const MAX_AT_ONCE = 2;
const RUN_TIMEOUT_MS = 20 * 60_000;
const RUNS_DIR = path.join(DATA_DIR, "review-runs");
const LOCK_DIR = path.join(DATA_DIR, "review-locks");
const LOCK_STALE_MS = RUN_TIMEOUT_MS + 5 * 60_000;

const g = globalThis as { lensWatchChecking?: boolean };

// Look for watched PRs with unreviewed commits and start their reviews. Safe to call
// often: a PR already running, failed at this commit, or reviewed at it is left alone.
export async function watchCheck(board: ReviewBoard): Promise<void> {
  if (g.lensWatchChecking) return;
  g.lensWatchChecking = true;
  try {
    const watch = await watchList();
    if (!Object.keys(watch).length || !board.prs.length) return;
    const records = await allRecords();
    for (const pr of board.prs) {
      if (liveRuns.size >= MAX_AT_ONCE) break;
      const w = watch[pr.url];
      if (!w || !pr.headSha || liveRuns.has(pr.url)) continue;
      const last = records[pr.url]?.runs.at(-1);
      if (last?.headSha === pr.headSha) continue; // reviewed at this commit
      if (!last && pr.headSha === w.since) continue; // never reviewed, and nothing new since you switched it on
      if ((await failedAt(pr.url)) === pr.headSha) continue; // failed here: Retry starts it again
      await start(pr, board.clones[pr.repo.toLowerCase()] ?? null);
    }
  } catch (e) {
    await logActivity({ kind: "error", detail: `Auto re-review couldn't check for new commits: ${(e as Error).message.slice(0, 200)}` });
  } finally {
    g.lensWatchChecking = false;
  }
}

// Stop a running auto review. It counts as failed at that commit, so it isn't started
// again until you press Retry or the author pushes again.
export function stopAuto(url: string): boolean {
  const r = liveRuns.get(url);
  r?.kill?.();
  return !!r;
}

// Retry a failed one now.
export async function retryAuto(url: string) {
  await setFailed(url, null);
  await watchCheck(await reviewBoard(false));
}

// ── One review at a time per PR, across every Vlens on this Mac ──
// The dev server and the app share the data folder: a lock file per PR (created with
// "wx", so only one process wins) keeps them from reviewing the same commit twice.

const lockFile = (url: string) => path.join(LOCK_DIR, `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.lock`);

async function takeLock(url: string): Promise<boolean> {
  await fs.mkdir(LOCK_DIR, { recursive: true });
  const file = lockFile(url);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await fs.writeFile(file, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: "wx" });
      return true;
    } catch {
      // Someone holds it: take it over only if its owner is gone or it's far too old.
      try {
        const l = JSON.parse(await fs.readFile(file, "utf8")) as { pid: number; at: number };
        let alive = true;
        try {
          process.kill(l.pid, 0);
        } catch {
          alive = false;
        }
        if (alive && Date.now() - l.at < LOCK_STALE_MS) return false;
      } catch {
        /* half-written or unreadable: treat as stale */
      }
      await fs.rm(file, { force: true });
    }
  }
  return false;
}
const dropLock = (url: string) => fs.rm(lockFile(url), { force: true }).catch(() => {});

async function start(pr: PrSummary, clone: string | null) {
  if (!(await takeLock(pr.url))) return;
  let cancelled = false;
  const run: LiveRun = { url: pr.url, title: pr.title, headSha: pr.headSha, mode: "full", startedAt: new Date().toISOString(), sessionId: null, steps: [], kill: () => (cancelled = true) };
  liveRuns.set(pr.url, run);
  void review(run, pr, clone, () => cancelled).finally(async () => {
    liveRuns.delete(pr.url);
    await dropLock(pr.url);
    // Another watched PR may have been waiting for a free slot.
    void reviewBoard(false)
      .then(watchCheck)
      .catch(() => {});
  });
}

// A line in this run's progress, shown on the PR's card.
const stepOf = (run: LiveRun) => (text: string) => {
  if (run.steps.at(-1)?.text === text) return;
  run.steps.push({ at: new Date().toISOString(), text });
  if (run.steps.length > 40) run.steps.shift();
};

async function review(run: LiveRun, pr: PrSummary, clone: string | null, cancelled: () => boolean) {
  const step = stepOf(run);
  const checkStop = () => {
    if (cancelled()) throw new Error("Stopped.");
  };
  let sha = pr.headSha;
  try {
    step("Read the PR from GitHub");
    const snap = await prSnapshot(pr.url, true);
    sha = run.headSha = snap.headSha; // the board can be a minute old: GitHub's word wins
    const last = (await recordsFor(pr.url)).runs.at(-1);
    if (last?.headSha === snap.headSha) return; // someone reviewed it meanwhile
    // A rebase or a merge from the base branch: same changes, so the last review stands.
    if (last && last.diffHash === snap.diffHash) {
      await recordRun(pr.url, { ...last, headSha: snap.headSha, at: new Date().toISOString(), carried: true });
      await logActivity({ kind: "skipped", url: pr.url, title: pr.title, detail: `Same changes as the review at ${last.headSha.slice(0, 7)} (a rebase), so that review still stands` });
      return;
    }
    checkStop();
    const take = last ? await latestTake(pr.url).catch(() => null) : null;
    const followUp = last ? { sha: last.headSha, earlier: take?.result.findings ?? [] } : null;
    run.mode = followUp ? "followup" : "full";
    const pre = await prefetch(pr, snap.headSha, followUp);
    step(followUp ? "Saved the new commits and the last review" : "Saved the diff and earlier comments");
    checkStop();
    const prompt = autoReviewPrompt({ ...pr, headSha: snap.headSha }, { dir: pre.dir, hasClone: !!clone, risk: riskOf(pr), followUp: followUp && { sha: followUp.sha, hasNewPatch: pre.hasNewPatch } });
    const out = await runClaude(run, prompt, clone ?? pre.dir, pre.dir);
    if (!out.ok) throw new Error(out.error);
    const result = parseResult(out.text);
    if (result?.kind !== "review") throw new Error("Claude finished without a review result.");
    await recordRun(pr.url, { sessionId: out.sessionId, headSha: snap.headSha, diffHash: snap.diffHash, at: run.startedAt, by: "auto" });
    await setFailed(pr.url, null);
    const n = result.findings.length;
    await logActivity({
      kind: "reviewed",
      url: pr.url,
      title: pr.title,
      detail: `Auto ${followUp ? "follow-up " : ""}review at ${snap.headSha.slice(0, 7)}: ${n} finding${n === 1 ? "" : "s"}${result.ready ? ", ready to approve" : ""}`,
    });
  } catch (e) {
    const error = (e as Error).message.slice(0, 300);
    await setFailed(pr.url, { headSha: sha, at: new Date().toISOString(), error });
    await logActivity({ kind: "error", url: pr.url, title: pr.title, detail: `Auto review failed: ${error}` });
  }
}

// Everything the review needs, saved where Claude may read it.
async function prefetch(pr: PrSummary, sha: string, followUp: { sha: string; earlier: import("./reviewResult").Finding[] } | null): Promise<{ dir: string; hasNewPatch: boolean }> {
  const dir = path.join(RUNS_DIR, `${pr.repo.replace("/", "_")}-${pr.number}-${sha.slice(0, 7)}`);
  await fs.mkdir(dir, { recursive: true });
  const [view, diff, comments, since] = await Promise.all([
    gh(["pr", "view", pr.url, "--json", "title,body,author,headRefName,baseRefName,files"]),
    gh(["pr", "diff", pr.url], 60_000),
    gh(["api", `repos/${pr.repo}/pulls/${pr.number}/comments`, "--paginate", "--jq", "[.[] | {id, path, line, user: .user.login, body, in_reply_to_id}]"], 30_000),
    // Only the new commits. Fails when the reviewed commit is gone (a force-push).
    followUp ? gh(["api", "-H", "Accept: application/vnd.github.diff", `repos/${pr.repo}/compare/${followUp.sha}...${sha}`], 60_000) : Promise.resolve(null),
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
  const all = comments.ok
    ? comments.out
        .trim()
        .split(/\n(?=\[)/)
        .flatMap((x) => {
          try {
            return JSON.parse(x);
          } catch {
            return [];
          }
        })
    : [];
  const hasNewPatch = !!since?.ok && !!since.out.trim();
  await Promise.all([
    fs.writeFile(path.join(dir, "pr.md"), md),
    fs.writeFile(path.join(dir, "diff.patch"), diff.out),
    fs.writeFile(path.join(dir, "comments.json"), JSON.stringify(all, null, 1)),
    hasNewPatch ? fs.writeFile(path.join(dir, "new.patch"), since!.out) : fs.rm(path.join(dir, "new.patch"), { force: true }),
    followUp ? fs.writeFile(path.join(dir, "earlier.md"), earlierFindings(followUp.earlier)) : Promise.resolve(),
  ]);
  await prune();
  return { dir, hasNewPatch };
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
function runClaude(run: LiveRun, prompt: string, cwd: string, dir: string): Promise<{ ok: true; text: string; sessionId: string } | { ok: false; error: string }> {
  const step = stepOf(run);
  const env = { ...process.env };
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--tools", "Read,Grep,Glob", "--disallowedTools", "Read(**/.env*)", "Read(**/*.pem)", "Read(**/*.key)", "--permission-mode", "dontAsk", "--strict-mcp-config", "--add-dir", dir, "--effort", "medium"];
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
          if (ev.session_id && !sessionId) sessionId = run.sessionId = ev.session_id;
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
    const stop = () => {
      stopped = true;
      child.kill("SIGTERM");
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 5_000).unref();
    };
    const timer = setTimeout(stop, RUN_TIMEOUT_MS);
    const before = run.kill;
    run.kill = () => {
      before?.();
      stop();
    };
    child.on("close", () => {
      clearTimeout(timer);
      if (result && !result.is_error && sessionId) resolve({ ok: true, text: String(result.result ?? ""), sessionId });
      else resolve({ ok: false, error: stopped ? "Stopped." : String(result?.result || stderr.trim() || "Claude didn't finish.").slice(0, 300) });
    });
    child.on("error", (e) => resolve({ ok: false, error: e.message }));
  });
}
