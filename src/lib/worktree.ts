import "server-only";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// A new session can work in its own git worktree (like the desktop app does):
// `claude --worktree <name>` makes <repo>/.claude/worktrees/<name> on a
// branch "worktree-<name>", copies the gitignored files listed in
// .worktreeinclude, and runs there. Two sessions on one repo then never edit
// the same files.

const git = (cwd: string, args: string[]) =>
  promisify(execFile)("git", ["-C", cwd, ...args], { timeout: 10_000 }).then(
    (r) => r.stdout.trim(),
    () => null,
  );

// Whether a folder can get a worktree: inside a git repo with at least one commit.
export async function worktreeInfo(cwd: string): Promise<{ ok: true; root: string } | { ok: false; reason: string }> {
  const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) return { ok: false, reason: "Not a git repository." };
  if (!(await git(cwd, ["rev-parse", "--verify", "HEAD"]))) return { ok: false, reason: "Make a first commit, then a worktree can branch from it." };
  return { ok: true, root };
}

// Gets the repo ready and returns the args for `claude`. Keeps .claude/worktrees/
// out of `git status` with the repo's local ignore file (.git/info/exclude),
// which isn't committed.
export async function worktreeArgs(cwd: string): Promise<string[]> {
  const info = await worktreeInfo(cwd);
  if (!info.ok) throw new Error(info.reason);
  const common = await git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  if (common) {
    const file = path.join(common, "info", "exclude");
    const now = await fs.readFile(file, "utf8").catch(() => "");
    if (!now.split("\n").some((l) => l.trim() === "/.claude/worktrees/")) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, `${now && !now.endsWith("\n") ? "\n" : ""}# Vlens: session worktrees\n/.claude/worktrees/\n`);
    }
  }
  const day = new Date().toISOString().slice(5, 10).replace("-", "");
  return ["--worktree", `vlens-${day}-${randomBytes(2).toString("hex")}`];
}

// "/repo/.claude/worktrees/vlens-1104-ab12" -> { repo: "/repo", name: "vlens-1104-ab12" }
export function parseWorktree(cwd: string | null) {
  const m = cwd ? /^(.*)\/\.claude\/worktrees\/([^/]+)\/?$/.exec(cwd) : null;
  return m ? { repo: m[1], name: m[2] } : null;
}
