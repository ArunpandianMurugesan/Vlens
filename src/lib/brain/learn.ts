import "server-only";
import os from "node:os";
import { jsonStore } from "../jsonStore";
import { runClaudeOnce } from "../runClaude";
import { getSession, listSessions } from "../sessions";
import type { ChatMessage } from "../types";
import { addMemory, forgetMemory, getMemory, KINDS, type MemoryKind, similarTo, updateMemory } from "./store";

// The brain learns while you work (the "curator"). For each Claude session in the
// folders you picked, Vlens waits until a batch of new turns builds up (or the
// session goes quiet), drops noise with a quick check (no AI), and asks a small
// Claude model what's worth remembering: add, update or forget, against the
// closest memories it already has. Every change is logged, with its source.
//
// It's off until you turn it on (the Brain page), and it only reads sessions in
// the folders you chose. Nothing here is shown to your normal Claude sessions.

export interface BrainSettings {
  learn: boolean; // learn from your Claude sessions
  folders: string[]; // only sessions in these folders
  maxRunsPerDay: number; // curator calls per day, at most
}
export interface BrainActivity {
  id: string;
  at: string;
  kind: "learn" | "reflect";
  session?: { id: string; title: string; folder: string | null };
  ops: { op: "add" | "update" | "forget" | "merge" | "fade" | "strengthen"; id: string; title: string; why?: string }[];
  note?: string;
}

const settings = jsonStore<BrainSettings>("brain/settings.json", () => ({ learn: false, folders: [], maxRunsPerDay: 60 }));
// Where it got to in each session: messages read, and blocks read of the last one (a reply grows in place).
const cursors = jsonStore<Record<string, { seen: number; blocks?: number; at: string }>>("brain/cursors.json", () => ({}));
const activity = jsonStore<BrainActivity[]>("brain/activity.json", () => []);

export const brainSettings = () => settings.load();
export async function updateBrainSettings(p: Partial<BrainSettings>) {
  await settings.update((s) => {
    if (typeof p.learn === "boolean") s.learn = p.learn;
    if (Array.isArray(p.folders)) s.folders = [...new Set(p.folders.filter((f) => typeof f === "string" && f.startsWith("/")))].slice(0, 30);
    if (typeof p.maxRunsPerDay === "number") s.maxRunsPerDay = Math.max(1, Math.min(500, Math.round(p.maxRunsPerDay)));
  });
  return settings.load();
}
export const brainActivity = () => activity.load();
export async function logActivity(a: Omit<BrainActivity, "id" | "at">) {
  await activity.update((l) => {
    l.unshift({ id: Math.random().toString(36).slice(2, 10), at: new Date().toISOString(), ...a });
    l.splice(300);
  });
}

// ── Status (for the Brain page) ──────────────────────────────────────────────

const g = globalThis as { lensBrainLearn?: { running: boolean; lastRun: string | null; skipped: number; lastError: string | null; timer?: ReturnType<typeof setInterval> } };
const state = (g.lensBrainLearn ??= { running: false, lastRun: null, skipped: 0, lastError: null });

export async function learnStatus() {
  const today = new Date().toISOString().slice(0, 10);
  const runs = (await activity.load()).filter((a) => a.kind === "learn" && a.at.startsWith(today)).length;
  return { running: state.running, lastRun: state.lastRun, skipped: state.skipped, lastError: state.lastError, runsToday: runs, watched: Object.keys(await cursors.load()).length };
}

// ── Reading the new part of a session ────────────────────────────────────────

const EDITS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SIGNAL = /\b(decid|because|root cause|the fix|fixed|turns out|should(n't)?|must|always|never|plan|todo|next step|the issue|bug|broke|works now|instead)\b/gi;
const SECRET = /(gh[pousr]_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9-]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})/;

function cmd(input: unknown) {
  const i = (input ?? {}) as Record<string, unknown>;
  return String(i.command ?? i.file_path ?? i.path ?? i.pattern ?? i.url ?? "").slice(0, 160);
}

// The new messages as plain text, plus how much in them looks worth remembering.
function digest(messages: ChatMessage[]) {
  const lines: string[] = [];
  let edits = 0;
  let commits = 0;
  let talk = 0;
  for (const m of messages) {
    for (const b of m.blocks) {
      if (b.kind === "text" && (m.role === "user" || m.role === "assistant")) {
        const t = b.text.trim();
        if (!t) continue;
        talk += t.length;
        lines.push(`${m.role === "user" ? "USER" : "CLAUDE"}: ${t.slice(0, 900)}`);
      } else if (b.kind === "tool_use") {
        if (EDITS.has(b.name)) edits++;
        const c = cmd(b.input);
        if (/git commit|gh pr (create|merge)/.test(c)) commits++;
        if (EDITS.has(b.name) || b.name === "Bash") lines.push(`[${EDITS.has(b.name) ? "edited" : "ran"} ${c}]`);
      } else if (b.kind === "compact") lines.push(`SUMMARY SO FAR: ${b.text.slice(0, 1500)}`);
    }
  }
  const text = lines.join("\n");
  const signals = (text.match(SIGNAL) ?? []).length;
  // Keep the end if it's long: that's where conclusions are.
  return { text: text.length > 9000 ? `…\n${text.slice(-9000)}` : text, edits, commits, talk, signals };
}

// Worth a model call? Something was changed or decided, and there's enough said.
export const worthIt = (d: { edits: number; commits: number; talk: number; signals: number }) => d.talk >= 200 && (d.edits > 0 || d.commits > 0 || d.signals >= 2);

// ── The curator ──────────────────────────────────────────────────────────────

type Op =
  | { op: "add"; title: string; text: string; kind: MemoryKind; importance?: number; tags?: string[] }
  | { op: "update"; id: string; title?: string; text?: string; importance?: number }
  | { op: "forget"; id: string; why?: string };

const PROMPT = (o: { title: string; folder: string; branch: string | null; related: string; chunk: string }) => `You keep the Vlens brain: long-term memory of the user's work, used by their bots. Read the new part of a Claude Code session and decide what is worth remembering for later work.

Session: "${o.title}" in ${o.folder}${o.branch ? ` (branch ${o.branch})` : ""}

Existing memories that may be related:
${o.related || "(none yet)"}

New part of the session:
<<<
${o.chunk}
>>>

Reply with ONLY JSON: {"ops": [...]}. Each op is one of:
{"op":"add","title":"short title","text":"plain words, with the why","kind":"decision|fact|howto|work|person|project","importance":0.0-1.0,"tags":["…"]}
{"op":"update","id":"<an existing id>","title":"…","text":"the full new text","importance":0.0-1.0}
{"op":"forget","id":"<an existing id>","why":"…"}

Rules:
- Keep only what helps future work: decisions and why, fixes and their root cause, how-tos, the state of a ticket or PR, who owns what, project facts.
- If an existing memory covers it, update that one instead of adding a near-copy. Forget one only if this part shows it is wrong or no longer true.
- One idea per memory. Name files, repos, tickets and PRs exactly.
- Skip chit-chat, routine commands, guesses that weren't confirmed, and anything secret (tokens, passwords, keys).
- Usually 0 to 3 ops. {"ops": []} is a fine answer.`;

function parseOps(text: string): Op[] {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try {
    const j = JSON.parse(m[0]) as { ops?: unknown[] };
    return (Array.isArray(j.ops) ? j.ops : []).slice(0, 5) as Op[];
  } catch {
    return [];
  }
}

// One batch of new messages from one session through the curator.
export async function curate(o: { sessionId: string; title: string; folder: string | null; branch: string | null; messages: ChatMessage[] }) {
  const d = digest(o.messages);
  if (!worthIt(d)) {
    state.skipped++;
    return { skipped: true as const };
  }
  const related = (await similarTo(d.text.slice(0, 3000), 8)).filter((m) => m.match > 0.3);
  const prompt = PROMPT({
    title: o.title,
    folder: (o.folder ?? "").replace(os.homedir(), "~"),
    branch: o.branch,
    related: related.map((m) => `[${m.id}] (${m.kind}) ${m.title}: ${m.text.slice(0, 300)}`).join("\n"),
    chunk: d.text,
  });
  const r = await runClaudeOnce({ prompt, args: ["--model", "haiku", "--tools", "", "--no-session-persistence"], cwd: os.tmpdir(), timeoutMs: 120_000 });
  if (!r.ok) throw new Error(r.error || "The curator didn't answer.");
  const source = { type: "session" as const, id: o.sessionId, note: o.title.slice(0, 80) };
  const done: BrainActivity["ops"] = [];
  for (const op of parseOps(r.text)) {
    try {
      if (op.op === "add") {
        if (!op.title || !op.text || SECRET.test(op.title + op.text)) continue;
        const kind = KINDS.includes(op.kind) ? op.kind : "fact";
        const near = (await similarTo(`${op.title}\n${op.text}`, 1))[0];
        if (near && near.match > 0.92) {
          const m = await updateMemory(near.id, { text: op.text, importance: Math.max(near.importance, op.importance ?? 0), by: "curator", source });
          done.push({ op: "update", id: m.id, title: m.title });
        } else {
          const m = await addMemory({ title: op.title, text: op.text, kind, importance: op.importance ?? 0.5, tags: op.tags, source });
          done.push({ op: "add", id: m.id, title: m.title });
        }
      } else if (op.op === "update") {
        if (!(await getMemory(op.id)) || SECRET.test(`${op.title ?? ""}${op.text ?? ""}`)) continue;
        const m = await updateMemory(op.id, { title: op.title, text: op.text, importance: op.importance, by: "curator", source });
        done.push({ op: "update", id: m.id, title: m.title });
      } else if (op.op === "forget") {
        const m = await getMemory(op.id);
        if (!m || m.pinned) continue; // you pinned it: the curator doesn't remove it
        await forgetMemory(op.id, `curator: ${op.why ?? "no longer true"}`);
        done.push({ op: "forget", id: op.id, title: m.title, why: op.why });
      }
    } catch {
      // one bad op doesn't stop the others
    }
  }
  await logActivity({ kind: "learn", session: { id: o.sessionId, title: o.title, folder: o.folder }, ops: done, note: done.length ? undefined : "Nothing worth keeping." });
  return { skipped: false as const, ops: done };
}

// ── Watching your sessions ───────────────────────────────────────────────────

const BATCH = 8; // new blocks (text, tool calls) before it looks
const QUIET_MS = 3 * 60_000; // or once a session has been quiet this long

// One pass over the sessions in your folders. now: don't wait for a batch or quiet time.
export async function learnTick(o: { now?: boolean } = {}) {
  const s = await settings.load();
  if ((!s.learn && !o.now) || !s.folders.length || state.running) return;
  const today = new Date().toISOString().slice(0, 10);
  const runsToday = (await activity.load()).filter((a) => a.kind === "learn" && a.at.startsWith(today)).length;
  if (runsToday >= s.maxRunsPerDay) return;
  state.running = true;
  try {
    const all = await listSessions();
    const inFolders = all.filter((x) => !x.botId && x.cwd && s.folders.some((f) => x.cwd === f || x.cwd!.startsWith(`${f}/`)) && Date.now() - Date.parse(x.updatedAt) < 2 * 86_400_000);
    const seen = await cursors.load();
    let runs = runsToday;
    for (const x of inFolders) {
      const c = seen[x.id];
      if (c && x.updatedAt <= c.at) continue;
      const full = await getSession(x.id);
      if (!full) continue;
      const msgs = full.messages;
      const mark = { seen: msgs.length, blocks: msgs.at(-1)?.blocks.length ?? 0, at: x.updatedAt };
      // A session it hasn't seen before: start from now, not from its whole history.
      if (!c) {
        await cursors.update((m) => void (m[x.id] = mark));
        continue;
      }
      // What's new: the rest of the message it was in the middle of, then the ones after.
      const last = c.seen > 0 ? msgs[c.seen - 1] : undefined;
      const rest = last && last.blocks.length > (c.blocks ?? last.blocks.length) ? [{ ...last, blocks: last.blocks.slice(c.blocks) }] : [];
      const fresh = [...rest, ...msgs.slice(c.seen)];
      const size = fresh.reduce((n, m) => n + m.blocks.length, 0);
      const quiet = Date.now() - Date.parse(x.updatedAt) >= QUIET_MS;
      if (!size || (!o.now && size < BATCH && !quiet)) continue;
      if (runs >= s.maxRunsPerDay) break;
      const r = await curate({ sessionId: x.id, title: x.title, folder: x.cwd, branch: full.branch ?? null, messages: fresh });
      if (!r.skipped) runs++;
      await cursors.update((m) => void (m[x.id] = mark));
    }
    state.lastRun = new Date().toISOString();
    state.lastError = null;
  } catch (e) {
    state.lastError = (e as Error).message;
  } finally {
    state.running = false;
  }
}

// While Vlens runs: look every minute, and tidy up when it's been quiet a while.
export function startBrain() {
  if (state.timer) return;
  state.timer = setInterval(async () => {
    await learnTick().catch(() => {});
    const { reflectIfDue } = await import("./reflect");
    await reflectIfDue().catch(() => {});
  }, 60_000);
}
