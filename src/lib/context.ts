import "server-only";
import { activeSessions } from "./active";
import { markRecent } from "./recent";
import { runClaudeOnce } from "./runClaude";
import { getSession } from "./sessions";

// Two ways to stop a long session from making every message expensive.

async function idle(id: string) {
  const s = await getSession(id);
  if (!s) throw new Error("Session not found.");
  // Two writers on one session file would tangle it.
  if ((await activeSessions()).has(id)) throw new Error("This session is open in a terminal or the desktop app. Run /compact there, or close it first.");
  return s;
}

// /compact: Claude summarizes the conversation and continues from the summary.
export async function compactSession(id: string) {
  const s = await idle(id);
  const r = await runClaudeOnce({ prompt: "/compact", args: ["--resume", s.id], cwd: s.cwd, timeoutMs: 10 * 60_000 });
  if (!r.ok) throw new Error(r.error);
  await markRecent(s.id);
}

const HANDOFF = `Write a handoff note so a brand-new session can continue this work without the old conversation.

Include, briefly:
- Goal: what we're building or fixing, and why.
- Done so far: the decisions made and the changes that landed (files, commands, links).
- Current state: what works, what's broken, anything half-finished.
- Next steps: the concrete next 1 to 5 things to do.
- Gotchas: constraints, preferences and traps a newcomer would hit.

Write it as a message to the next session ("You are continuing…"). Use real names (files, functions, branches, tickets). Keep it under 400 words. Reply with only the note.`;

// Fresh start: ask the old session for a handoff note; the new session starts from it.
export async function handoffNote(id: string) {
  const s = await idle(id);
  // A mid-size model is plenty for a summary and cheaper on a long history. No tools: just write.
  const r = await runClaudeOnce({ prompt: HANDOFF, args: ["--resume", s.id, "--model", "sonnet", "--tools", ""], cwd: s.cwd });
  if (!r.ok || !r.text.trim()) throw new Error(r.error || "Claude didn't write a note.");
  return { note: r.text.trim(), cwd: s.cwd, title: s.title };
}
