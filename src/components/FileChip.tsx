"use client";

import { FileCode2, FilePlus2, Loader2, XCircle } from "lucide-react";
import type { ToolRun } from "@/hooks/useTreeChat";
import { useCwd, useFiles } from "./FileContext";

// Tools that change a file get a chip like "step1_basics.py +59 −0" that opens it.
export const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

// Lines added and removed between two texts (a small LCS diff; fine for edit-sized text).
function lineDiff(before: string, after: string): { add: number; del: number } {
  const a = before ? before.split("\n") : [];
  const b = after ? after.split("\n") : [];
  if (a.length * b.length > 4_000_000) return { add: b.length, del: a.length };
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const same = dp[0][0];
  return { add: b.length - same, del: a.length - same };
}

interface EditInput {
  file_path?: string;
  notebook_path?: string;
  content?: string;
  old_string?: string;
  new_string?: string;
  edits?: { old_string?: string; new_string?: string }[];
}

export function fileChange(run: ToolRun) {
  const i = (run.input ?? {}) as EditInput;
  const path = i.file_path ?? i.notebook_path;
  if (!path) return null;
  if (run.name === "Write") return { path, add: (i.content ?? "").split("\n").length, del: 0, find: (i.content ?? "").split("\n")[0] || undefined, created: true };
  const edits = run.name === "MultiEdit" ? (i.edits ?? []) : [{ old_string: i.old_string, new_string: i.new_string }];
  let add = 0, del = 0;
  for (const e of edits) {
    const d = lineDiff(e.old_string ?? "", e.new_string ?? "");
    add += d.add;
    del += d.del;
  }
  // Highlight what the (first) edit put in.
  return { path, add, del, find: edits[0]?.new_string || undefined, created: false };
}

export function FileChip({ run }: { run: ToolRun }) {
  const files = useFiles();
  const cwd = useCwd();
  const c = fileChange(run);
  if (!c) return null;
  const failed = run.result?.isError;
  const pending = !run.result;
  const name = c.path.split("/").pop();
  const Icon = failed ? XCircle : c.created ? FilePlus2 : FileCode2;
  return (
    <button
      onClick={() => files?.open(c.path, { cwd, find: c.find })}
      title={failed ? `${run.name} failed: ${run.result?.text.slice(0, 200)}` : `Open ${c.path}`}
      className="flex w-full items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-left text-sm transition hover:border-accent"
    >
      <Icon size={14} className={`shrink-0 ${failed ? "text-red-500" : "text-muted"}`} />
      <span className={`min-w-0 flex-1 truncate ${failed ? "text-muted line-through" : ""}`}>{name}</span>
      {pending ? (
        <Loader2 size={12} className="shrink-0 animate-spin text-muted" />
      ) : (
        <span className="shrink-0 font-mono text-xs tabular-nums">
          <span className="text-emerald-600 dark:text-emerald-400">+{c.add}</span> <span className="text-red-500">−{c.del}</span>
        </span>
      )}
    </button>
  );
}
