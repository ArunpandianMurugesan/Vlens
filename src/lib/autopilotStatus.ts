import "server-only";
import type { RunningReview } from "./autopilotPlan";

// What the runner is doing, in memory (it survives hot reloads, not a restart).
// Kept apart from autopilotRunner.ts so the state store can read it without a cycle.
export type Run = RunningReview & { kill?: () => void };
export interface RunnerMemory {
  runs: Map<string, Run>; // the worker pool: PR url -> its running review
  lastCheck: string | null;
  timer?: ReturnType<typeof setInterval>;
  busy?: boolean; // a check is under way
  again?: boolean; // a worker freed up during a check: look again when it ends
}
const g = globalThis as { lensAutopilotRunner?: RunnerMemory };
export const runner: RunnerMemory = (g.lensAutopilotRunner ??= { runs: new Map(), lastCheck: null });
runner.runs ??= new Map(); // a runner kept from before the pool (hot reload)

export function runnerStatus(): { running: RunningReview[]; lastCheck: string | null } {
  const running = [...runner.runs.values()]
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .map((r) => ({ url: r.url, title: r.title, headSha: r.headSha, workflow: r.workflow, startedAt: r.startedAt, sessionId: r.sessionId, steps: r.steps.slice(-8) }));
  return { running, lastCheck: runner.lastCheck };
}
