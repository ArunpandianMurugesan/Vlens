import "server-only";
import type { RunningReview } from "./autopilotPlan";

// What the runner is doing, in memory (it survives hot reloads, not a restart).
// Kept apart from autopilotRunner.ts so the state store can read it without a cycle.
export interface RunnerMemory {
  running: (RunningReview & { kill?: () => void }) | null;
  lastCheck: string | null;
  timer?: ReturnType<typeof setInterval>;
  busy?: boolean; // a check is under way
  capLogged?: string; // the day the "daily cap reached" note was logged
}
const g = globalThis as { lensAutopilotRunner?: RunnerMemory };
export const runner: RunnerMemory = (g.lensAutopilotRunner ??= { running: null, lastCheck: null });

export function runnerStatus(): { running: RunningReview | null; lastCheck: string | null } {
  const r = runner.running;
  return { running: r ? { url: r.url, title: r.title, headSha: r.headSha, workflow: r.workflow, startedAt: r.startedAt, sessionId: r.sessionId, steps: r.steps.slice(-8) } : null, lastCheck: runner.lastCheck };
}
