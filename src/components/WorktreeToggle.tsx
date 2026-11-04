"use client";

import { GitBranch } from "lucide-react";
import { useEffect, useState } from "react";

// "New worktree" for a session you're about to start: it works in its own copy
// of the repo on its own branch, so it can't trip over another session's edits.
// Remembered per folder.
const KEY = "lens.worktree";
const read = (): Record<string, boolean> => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
};
export const lastWorktree = (cwd: string) => !!read()[cwd];
export const rememberWorktree = (cwd: string, on: boolean) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...read(), [cwd]: on }));
  } catch {}
};

export function WorktreeToggle({ cwd, on, onChange }: { cwd: string; on: boolean; onChange: (on: boolean) => void }) {
  const [state, setState] = useState<{ ok: boolean; reason?: string } | null>(null);
  useEffect(() => {
    let stop = false;
    setState(null);
    fetch(`/api/worktree?cwd=${encodeURIComponent(cwd)}`)
      .then((r) => r.json())
      .then((d: { ok: boolean; reason?: string }) => !stop && setState(d))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [cwd]);
  // Not a git repo: nothing to offer. A repo without commits: say why it's off.
  if (!state || (!state.ok && state.reason === "Not a git repository.")) return null;
  const off = !state.ok;
  return (
    <button
      type="button"
      disabled={off}
      onClick={() => onChange(!on)}
      title={
        off
          ? state.reason
          : on
            ? "This session gets its own worktree and branch (in .claude/worktrees/). Click to work in the folder itself."
            : "Work in a new git worktree on its own branch, so parallel sessions don't edit the same files"
      }
      className={`flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[0.7rem] outline-none disabled:opacity-40 ${
        on && !off ? "bg-accent-soft text-accent" : "bg-sunken text-muted hover:text-ink"
      }`}
    >
      <GitBranch size={11} /> {on && !off ? "New worktree" : "Worktree off"}
    </button>
  );
}
