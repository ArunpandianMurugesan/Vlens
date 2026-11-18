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
  timer?: ReturnType<typeof setTimeout>;
}

const g = globalThis as { lensPermissions?: Map<string, Pending> };
const pending = (g.lensPermissions ??= new Map());

// Waits until you answer, like the terminal does: step away and the question is
// still there when you're back. It only goes when the run ends or you stop it.
// timeoutMs: give up (deny) after that long instead.
export function waitForDecision(id: string, timeoutMs?: number): Promise<Reply> {
  return new Promise((resolve) => {
    const timer = timeoutMs ? setTimeout(() => settle(id, "deny"), timeoutMs) : undefined;
    pending.set(id, { answer: resolve, timer });
  });
}

// Returns false if the question is gone (already answered, stopped, or the run ended).
export function settle(id: string, d: Reply): boolean {
  asks.delete(id);
  const p = pending.get(id);
  if (!p) return false;
  clearTimeout(p.timer);
  pending.delete(id);
  p.answer(d);
  return true;
}

// What each waiting question is about, so places other than its chat (the Mac
// menu bar) can show it and answer it. Noted by whoever asks; gone once settled.
export interface AskInfo {
  id: string;
  kind: "tool" | "question" | "plan";
  tool: string;
  summary: string; // the command, the file, or the question
  always: boolean; // has an "always allow" choice
  sessionId?: string | null; // a session's run
  at: number;
}
const ga = globalThis as { lensAsks?: Map<string, AskInfo> };
const asks = (ga.lensAsks ??= new Map());

export function noteAsk(a: Omit<AskInfo, "at" | "summary" | "kind"> & { input?: unknown; preview?: string | null }) {
  const input = (a.input ?? {}) as Record<string, unknown>;
  const kind = a.tool === "AskUserQuestion" ? "question" : a.tool === "ExitPlanMode" ? "plan" : "tool";
  const q = Array.isArray(input.questions) ? String((input.questions[0] as { question?: string })?.question ?? "") : "";
  const summary =
    a.preview?.split("\n")[0] ??
    (kind === "question" ? q : kind === "plan" ? "Plan ready for review" : String(input.command ?? input.file_path ?? input.notebook_path ?? input.url ?? input.pattern ?? ""));
  asks.set(a.id, { id: a.id, kind, tool: a.tool, summary: summary.slice(0, 160), always: a.always, sessionId: a.sessionId, at: Date.now() });
}
export const listAsks = () => [...asks.values()].sort((x, y) => x.at - y.at);
