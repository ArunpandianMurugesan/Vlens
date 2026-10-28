import "server-only";
import type { PermissionMode } from "./modes";

// Permission questions from running `claude -p` processes, waiting for you to
// answer in the browser. Kept on globalThis so the API route that receives your
// answer and the run that asked share one map (route modules load separately).
export type Decision = "allow" | "always" | "deny";
// Your picks for Claude's AskUserQuestion: question text → chosen label(s), comma separated.
export type Answers = Record<string, string>;
// `deny` with a message: "No, and tell Claude what to do differently".
// `approve`: you accepted Claude's plan; Claude carries on in that mode.
export type Reply = Decision | { answers: Answers } | { deny: string } | { approve: PermissionMode };

interface Pending {
  answer: (d: Reply) => void;
  timer: ReturnType<typeof setTimeout>;
}

const g = globalThis as { lensPermissions?: Map<string, Pending> };
const pending = (g.lensPermissions ??= new Map());

// Nobody answering shouldn't hang a run forever.
const TIMEOUT_MS = 10 * 60_000;

export function waitForDecision(id: string): Promise<Reply> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(id, "deny"), TIMEOUT_MS);
    pending.set(id, { answer: resolve, timer });
  });
}

// Returns false if the question is gone (already answered, timed out, or the run ended).
export function settle(id: string, d: Reply): boolean {
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.answer(d);
  return true;
}
