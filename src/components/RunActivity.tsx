"use client";

import { Bot, Check, Loader2, Terminal, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { LiveRun } from "@/hooks/useTreeChat";
import type { RunStatus, TaskInfo } from "@/lib/types";

// Ticks once a second while `on`, so running timers count up.
function useNow(on: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [on]);
  return now;
}

function secs(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function statusLabel(s: RunStatus | undefined, agents: number, background: number) {
  if (agents) return agents === 1 ? "Waiting on a sub-agent…" : `Waiting on ${agents} sub-agents…`;
  if (background && s?.kind === "writing") return "Background work still running…";
  if (!s || s.kind === "requesting") return "Waiting for Claude…";
  if (s.kind === "thinking") return "Thinking…";
  if (s.kind === "tool") return `Running ${s.tool}…`;
  return null; // writing: the text itself shows it, with the caret
}

// What Claude is doing while it replies, like the CLI's spinner line, plus the
// sub-agents and background commands it started and how far along they are.
export function RunActivity({
  run,
  replying,
  compact,
  onStop,
  onStopTask,
}: {
  run: LiveRun;
  replying: boolean;
  compact?: boolean;
  onStop?: () => void;
  onStopTask?: (taskId: string) => Promise<void>; // stop just this background task
}) {
  const tasks = Object.values(run.tasks ?? {});
  const running = tasks.some((t) => t.status === "running");
  const now = useNow(replying || running);
  const fgAgents = tasks.filter((t) => t.status === "running" && !t.background && !t.parentId).length;
  const bg = tasks.filter((t) => t.status === "running" && t.background).length;
  const label = replying ? statusLabel(run.status, fgAgents, bg) : null;
  if (!label && !tasks.length) return null;
  return (
    <div className={`space-y-2 ${compact ? "" : "pl-10"}`} data-no-select>
      {tasks.length > 0 && (
        <div className="space-y-1">
          {tasks.filter((t) => !t.parentId).map((t) => (
            <TaskRow key={t.id} task={t} now={now} subs={tasks.filter((c) => c.parentId === t.id)} onStop={onStopTask} />
          ))}
        </div>
      )}
      {label && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={13} className="animate-spin text-accent" />
          <span>{label}</span>
          {run.startedAt && <span className="tabular-nums text-xs">{secs(now - run.startedAt)}</span>}
          {onStop && (
            <button onClick={onStop} className="rounded border border-line px-1.5 text-xs hover:border-accent hover:text-accent">
              Stop
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task: t, now, subs, onStop }: { task: TaskInfo; now: number; subs: TaskInfo[]; onStop?: (id: string) => Promise<void> }) {
  const [stopping, setStopping] = useState(false);
  const Icon = t.kind === "local_bash" ? Terminal : Bot;
  const ms = t.status === "running" ? now - t.startedAt : t.ms;
  const doing =
    t.status !== "running" ? null : t.activity ?? (t.lastTool ? `Using ${t.lastTool}` : t.kind === "local_bash" ? null : "Starting…");
  return (
    <div className="rounded-lg border border-line bg-sunken/60 px-2.5 py-1.5 text-[0.8rem]">
      <div className="flex items-center gap-2">
        <Icon size={13} className={`shrink-0 ${t.status === "running" ? "animate-pulse text-accent" : "text-muted"}`} />
        <span className="min-w-0 truncate font-medium">{t.description || (t.kind === "local_bash" ? "Command" : "Sub-agent")}</span>
        {t.agentType && <span className="shrink-0 rounded bg-accent-soft px-1.5 text-[0.7rem] text-accent">{t.agentType}</span>}
        {t.background && <span className="shrink-0 rounded border border-line px-1.5 text-[0.7rem] text-muted">background</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted tabular-nums">
          {t.toolUses > 0 && <span>{t.toolUses} tool{t.toolUses === 1 ? "" : "s"}</span>}
          <span>{secs(ms)}</span>
          {t.status === "running" && onStop && (
            <button
              onClick={() => {
                setStopping(true);
                void onStop(t.id).finally(() => setStopping(false));
              }}
              disabled={stopping}
              title="Stop just this one (the reply and other work carry on)"
              className="rounded border border-line px-1.5 text-[0.7rem] hover:border-red-500 hover:text-red-600 disabled:opacity-50"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          )}
          {t.status === "running" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : t.status === "completed" ? (
            <Check size={12} className="text-emerald-600" />
          ) : (
            <X size={12} className="text-red-600" />
          )}
        </span>
      </div>
      {doing && <div className="mt-0.5 truncate pl-5 text-xs text-muted">{doing}</div>}
      {subs.length > 0 && (
        <div className="mt-1 space-y-1 pl-5">
          {subs.map((c) => (
            <TaskRow key={c.id} task={c} now={now} subs={[]} onStop={onStop} />
          ))}
        </div>
      )}
    </div>
  );
}
