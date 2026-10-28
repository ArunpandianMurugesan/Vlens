import "server-only";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { jsonStore } from "./jsonStore";
import { modelArgs } from "./models";
import { runClaudeOnce } from "./runClaude";
import { findSessionFile, listSessions } from "./sessions";
import { getSettings } from "./settings";
import type { CoachData, CoachSignal, Lesson, Retro, SessionSummary } from "./types";

// The coach reads your recent sessions for habits that cost time or tokens,
// runs retros on request, and keeps the lessons. Lessons you apply go into a
// block in CLAUDE.md that Lens owns; nothing outside that block is touched.

const WEEK = 7 * 86_400_000;
const store = jsonStore<{ retros: Record<string, Retro>; lessons: Lesson[] }>("coach.json", () => ({ retros: {}, lessons: [] }));

// "no", "wrong", "I said…": you steering Claude back.
const CORRECTION = /^\s*(no\b|nope\b|wrong\b|not that\b|that'?s not\b|that is not\b|i said\b|i told you\b|revert\b|undo\b|stop\b|don'?t\b|why did you\b)/i;
const BIG_PASTE = 20_000; // characters, roughly 5k tokens

interface Scan {
  reads: Map<string, number>; // file → times read this week
  errorStreak: number;
  corrections: number;
  pastes: number;
  biggestPaste: number;
}

const userText = (content: unknown): string | null => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content) || content.some((b) => b?.type === "tool_result")) return null;
  return content.map((b) => (b?.type === "text" ? b.text : "")).join("\n");
};

// One pass over a session file, this week only. Cached by mtime: files get big.
const scanCache = new Map<string, { mtimeMs: number; scan: Scan }>();
async function scan(file: string): Promise<Scan> {
  const { mtimeMs } = await fs.stat(file);
  const hit = scanCache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.scan;
  const since = Date.now() - WEEK;
  const out: Scan = { reads: new Map(), errorStreak: 0, corrections: 0, pastes: 0, biggestPaste: 0 };
  let streak = 0;
  for (const line of (await fs.readFile(file, "utf8")).split("\n")) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let d: { type?: string; timestamp?: string; isSidechain?: boolean; message?: { content?: unknown } };
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (!d.timestamp || Date.parse(d.timestamp) < since || d.isSidechain) continue;
    const content = d.message?.content;
    if (d.type === "assistant" && Array.isArray(content)) {
      for (const b of content)
        if (b?.type === "tool_use" && b.name === "Read" && typeof b.input?.file_path === "string")
          out.reads.set(b.input.file_path, (out.reads.get(b.input.file_path) ?? 0) + 1);
    } else if (d.type === "user") {
      if (Array.isArray(content))
        for (const b of content)
          if (b?.type === "tool_result") {
            streak = b.is_error ? streak + 1 : 0;
            out.errorStreak = Math.max(out.errorStreak, streak);
          }
      const text = userText(content);
      if (text && !text.startsWith("<")) {
        if (CORRECTION.test(text)) out.corrections++;
        if (text.length > BIG_PASTE) {
          out.pastes++;
          out.biggestPaste = Math.max(out.biggestPaste, text.length);
        }
      }
    }
  }
  scanCache.set(file, { mtimeMs, scan: out });
  return out;
}

const tokens = (chars: number) => `~${Math.round(chars / 4 / 1000)}k tokens`;
const short = (p: string) => p.split("/").slice(-3).join("/");

async function signals(sessions: SessionSummary[]): Promise<CoachSignal[]> {
  const since = Date.now() - WEEK;
  const recent = sessions.filter((s) => Date.parse(s.updatedAt) >= since && s.messageCount > 0);
  const scans = await Promise.all(
    recent.map(async (s) => {
      const f = await findSessionFile(s.id);
      return f ? { s, sc: await scan(f.file).catch(() => null) } : null;
    }),
  );
  const out: CoachSignal[] = [];
  const readIn = new Map<string, { sessions: Set<string>; times: number; cwd: string | null }>();

  for (const x of scans) {
    if (!x?.sc) continue;
    const { s, sc } = x;
    const base = { sessionId: s.id, sessionTitle: s.title, cwd: s.cwd };
    for (const [f, n] of sc.reads) {
      const r = readIn.get(f) ?? { sessions: new Set(), times: 0, cwd: s.cwd };
      r.sessions.add(s.id);
      r.times += n;
      readIn.set(f, r);
    }
    if (sc.errorStreak >= 5)
      out.push({ id: `errors-${s.id}`, kind: "errors", title: `${sc.errorStreak} tool errors in a row`, detail: `In “${s.title}”. Often a missing setup step (server not running, wrong folder, missing env). A retro can turn the fix into a lesson.`, ...base });
    if (sc.corrections >= 3)
      out.push({ id: `corr-${s.id}`, kind: "corrections", title: `You corrected Claude ${sc.corrections} times`, detail: `In “${s.title}”. Corrections usually mean Claude was missing context. A retro finds what to tell it up front next time.`, ...base });
    if (sc.pastes >= 2)
      out.push({ id: `paste-${s.id}`, kind: "pastes", title: `${sc.pastes} very large pastes`, detail: `In “${s.title}”, the biggest about ${tokens(sc.biggestPaste)}. Every later reply re-sends them. Point Claude at a file or paste only the lines that matter.`, ...base });
    const days = Object.keys(s.days ?? {}).length;
    if (days >= 7)
      out.push({ id: `long-${s.id}`, kind: "longlived", title: `One session, used on ${days} days this month`, detail: `“${s.title}” keeps growing, and every reply re-sends all of it. Start fresh per task (Fresh start carries the key points over).`, ...base });
  }
  for (const [f, r] of readIn)
    if (r.sessions.size >= 3)
      out.push({
        id: `reads-${f}`,
        kind: "rereads",
        title: `Claude read ${short(f)} in ${r.sessions.size} sessions`,
        detail: `${r.times} reads this week. A one-line note on what it holds, in CLAUDE.md, saves Claude from re-reading it to find out.`,
        cwd: r.cwd,
        lesson: `${f}: [what this file holds and when to look at it]`,
      });

  const rank: Record<CoachSignal["kind"], number> = { errors: 0, corrections: 1, longlived: 2, rereads: 3, pastes: 4 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]).slice(0, 8);
}

export async function getCoach(): Promise<CoachData> {
  const [sessions, data] = await Promise.all([listSessions(), store.load()]);
  return {
    signals: await signals(sessions),
    retros: Object.values(data.retros).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10),
    lessons: data.lessons,
  };
}

// ── Retro ──

// A small digest of a session for the retro: what you asked, where you pushed
// back, what failed, and how it ended. Never the whole transcript.
async function digest(file: string): Promise<string> {
  const asks: string[] = [];
  const errors: string[] = [];
  let lastReply = "";
  for (const line of (await fs.readFile(file, "utf8")).split("\n")) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let d: { type?: string; isSidechain?: boolean; message?: { content?: unknown } };
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.isSidechain) continue;
    const c = d.message?.content;
    if (d.type === "user") {
      const t = userText(c);
      if (t && !t.startsWith("<")) asks.push((CORRECTION.test(t) ? "[correction] " : "") + t.slice(0, 400).replace(/\s+/g, " "));
      if (Array.isArray(c))
        for (const b of c)
          if (b?.type === "tool_result" && b.is_error) {
            const txt = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x: { text?: string }) => x.text ?? "").join(" ") : "";
            errors.push(txt.slice(0, 200).replace(/\s+/g, " "));
          }
    } else if (d.type === "assistant" && Array.isArray(c)) {
      const t = c.map((b) => (b?.type === "text" ? b.text : "")).join(" ").trim();
      if (t) lastReply = t.slice(0, 1200);
    }
  }
  return [
    `What the user asked, in order (${asks.length} messages, the latest 60):`,
    ...asks.slice(-60).map((a) => `- ${a}`),
    "",
    `Tool errors (${errors.length}, the latest 20):`,
    ...errors.slice(-20).map((e) => `- ${e}`),
    "",
    `Claude's last reply: ${lastReply}`,
  ].join("\n");
}

const RETRO_PROMPT = `You are reviewing one finished Claude Code session to help the user work better with Claude next time.
Below is a digest: the user's messages ([correction] marks where they pushed back), tool errors, and Claude's last reply.

Reply with ONLY a JSON object, no prose, no code fence:
{"wentWell": [...], "mistakes": [...], "lessons": [...]}

- wentWell: up to 3 short things that worked (habits worth repeating).
- mistakes: up to 3 short things that cost time: wrong assumptions, missing context, repeated failures. Blame no one; describe what happened.
- lessons: up to 4 one-line instructions for Claude in future sessions in this project, written as rules ("Run go test inside the service folder, not the repo root."). Only lasting, project-specific facts or habits. No generic advice. Under 140 characters each.
Use plain, simple English. Empty arrays are fine.

DIGEST:
`;

function parseRetro(text: string): { wentWell: string[]; mistakes: string[]; lessons: string[] } {
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const d = JSON.parse(json);
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 200)).slice(0, n) : []);
  return { wentWell: list(d.wentWell, 3), mistakes: list(d.mistakes, 3), lessons: list(d.lessons, 4) };
}

export async function runRetro(sessionId: string): Promise<{ retro: Retro; lessons: Lesson[] }> {
  const found = await findSessionFile(sessionId);
  if (!found) throw new Error("Session not found.");
  const summary = (await listSessions()).find((s) => s.id === sessionId);
  const settings = await getSettings();
  const r = await runClaudeOnce({
    prompt: RETRO_PROMPT + (await digest(found.file)),
    // No tools, and no session file of its own (it would show up in History).
    args: [...modelArgs(settings.retroModel), "--no-session-persistence", "--disallowedTools", "Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task"],
    cwd: null,
    timeoutMs: 3 * 60_000,
  });
  if (!r.ok) throw new Error(r.error ?? "The retro didn't finish.");
  let parsed;
  try {
    parsed = parseRetro(r.text);
  } catch {
    throw new Error("Claude's retro wasn't in the expected format. Try again.");
  }
  const now = new Date().toISOString();
  const retro: Retro = { sessionId, title: summary?.title ?? "Session", cwd: summary?.cwd ?? null, at: now, wentWell: parsed.wentWell, mistakes: parsed.mistakes };
  const lessons: Lesson[] = parsed.lessons.map((text) => ({ id: randomUUID(), text, cwd: retro.cwd, sessionId, createdAt: now }));
  await store.update((d) => {
    d.retros[sessionId] = retro;
    // A new retro of the same session replaces its suggestions that weren't applied.
    d.lessons = [...d.lessons.filter((l) => l.sessionId !== sessionId || l.applied), ...lessons];
  });
  return { retro, lessons };
}

// ── Lessons and the CLAUDE.md block ──

const START = "<!-- lens:lessons start (managed by Claude Lens; edit these in Lens) -->";
const END = "<!-- lens:lessons end -->";
const BLOCK = /\n*<!-- lens:lessons start[^\n]*-->[\s\S]*?<!-- lens:lessons end -->\n?/;
const MAX_LINES = 15;

const fileFor = (target: "project" | "user", cwd: string | null) =>
  target === "user" ? path.join(os.homedir(), ".claude", "CLAUDE.md") : cwd ? path.join(cwd, "CLAUDE.md") : null;

// Rewrites only Lens's block in one CLAUDE.md, from the lessons applied to it.
async function writeBlock(file: string, lines: string[]) {
  let text = "";
  try {
    text = await fs.readFile(file, "utf8");
  } catch {}
  const rest = text.replace(BLOCK, "\n").replace(/\n{3,}$/, "\n\n");
  if (!lines.length) {
    if (text && rest !== text) await fs.writeFile(file, rest.trimEnd() + "\n");
    return;
  }
  const block = [START, "## Lessons from past sessions", ...lines.slice(-MAX_LINES).map((l) => `- ${l}`), END].join("\n");
  const next = rest.trim() ? `${rest.trimEnd()}\n\n${block}\n` : `${block}\n`;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, next);
}

async function syncFile(target: "project" | "user", cwd: string | null, all: Lesson[]) {
  const file = fileFor(target, cwd);
  if (!file) return;
  const lines = all.filter((l) => l.applied === target && (target === "user" || l.cwd === cwd)).map((l) => l.text);
  await writeBlock(file, lines);
}

// Whether a project's CLAUDE.md is committed to git, so a lesson there reaches your team too.
export async function isTracked(cwd: string): Promise<boolean> {
  const r = await promisify(execFile)("git", ["ls-files", "--error-unmatch", "CLAUDE.md"], { cwd }).then(
    () => true,
    () => false,
  );
  return r;
}

export async function saveLesson(text: string, cwd: string | null, sessionId?: string): Promise<Lesson> {
  const lesson: Lesson = { id: randomUUID(), text: text.trim().slice(0, 200), cwd, sessionId, createdAt: new Date().toISOString() };
  await store.update((d) => void d.lessons.push(lesson));
  return lesson;
}

export async function updateLesson(id: string, patch: { text?: string; apply?: "project" | "user" | null; remove?: boolean }) {
  const settings = await getSettings();
  if (patch.apply && !settings.lessonsToClaudeMd) throw new Error("Writing lessons to CLAUDE.md is off in Settings → Coach.");
  let before: Lesson | undefined;
  let all: Lesson[] = [];
  await store.update((d) => {
    before = d.lessons.find((l) => l.id === id);
    if (!before) return;
    if (patch.remove) d.lessons = d.lessons.filter((l) => l.id !== id);
    else
      d.lessons = d.lessons.map((l) =>
        l.id !== id ? l : { ...l, text: patch.text?.trim() ? patch.text.trim().slice(0, 200) : l.text, applied: patch.apply === undefined ? l.applied : patch.apply ?? undefined },
      );
    all = d.lessons;
  });
  if (!before) throw new Error("That lesson is gone.");
  if (patch.apply === "project" && !before.cwd) throw new Error("This lesson has no project folder; add it to all projects instead.");
  // Rewrite every CLAUDE.md block the lesson was in or is now in.
  const after = all.find((l) => l.id === id);
  const targets = new Set([before.applied, after?.applied].filter(Boolean) as ("project" | "user")[]);
  for (const t of targets) await syncFile(t, before.cwd, all);
}
