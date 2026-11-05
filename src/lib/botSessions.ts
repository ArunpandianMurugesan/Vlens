/* eslint-disable @typescript-eslint/no-explicit-any -- reads untyped session JSONL lines */
import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { BOTS_DIR } from "./bots";
import { findSessionFile, listSessions, PROJECTS_DIR } from "./sessions";
import type { Bot, SessionSummary } from "./types";

// What a bot may read of your Claude sessions, when you allow it (its Settings,
// "Read my Claude sessions"): the sessions from any Claude Code on this Mac
// (terminal, desktop app, Vlens, IDEs), running or ended, and each project's
// memory files. Only the folders you picked; never other bots' chats; and its
// "Don't look at" paths still win. Read-only: it can't change a session.

const MAX_CHARS = 40_000;

export const hasSessionAccess = (b: Bot) => !!b.sessionAccess && (b.sessionAccess.all || b.sessionAccess.folders.length > 0);

const expand = (p: string) => p.replace(/^~(?=\/|$)/, os.homedir()).replace(/\/+$/, "");
const inside = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);
// Claude Code's name for a folder under ~/.claude/projects. A session keeps the folder
// it started in as its cwd, so one moved or renamed since is matched by this too.
const encode = (dir: string) => dir.replace(/[^A-Za-z0-9]/g, "-");

// Its "Don't look at" rules that are paths: folders it must not read sessions from.
const blockedDirs = (b: Bot) => (b.rules?.dontLookAt ?? []).filter((r) => /^[~/]/.test(r.trim())).map((r) => expand(r.trim()));

function allowed(b: Bot, s: SessionSummary) {
  const a = b.sessionAccess;
  if (!a || !s.cwd || s.botId || inside(s.cwd, BOTS_DIR)) return false;
  if (blockedDirs(b).some((d) => inside(s.cwd!, d))) return false;
  return a.all || a.folders.some((f) => inside(s.cwd!, f) || s.projectDir === encode(f));
}

export async function sessionsFor(b: Bot) {
  return (await listSessions()).filter((s) => allowed(b, s)).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
}

const when = (iso: string) => iso.slice(0, 16).replace("T", " ");
const home = (p: string | null) => (p ?? "").replace(os.homedir(), "~");

export async function listSessionsText(b: Bot, o: { folder?: string; query?: string; limit?: number }) {
  let all = await sessionsFor(b);
  if (o.folder) all = all.filter((s) => s.cwd && inside(s.cwd, expand(o.folder!)));
  if (o.query) all = all.filter((s) => s.title.toLowerCase().includes(o.query!.toLowerCase()));
  const shown = all.slice(0, Math.min(o.limit ?? 30, 100));
  if (!shown.length) return "No sessions you may read match that.";
  return shown
    .map((s) => `${s.id} · ${s.title} · ${home(s.cwd)} · ${s.active ? `running (${s.active.entrypoint === "desktop" ? "desktop app" : s.active.byLens ? "Vlens" : "terminal"}, ${s.active.status})` : "ended"} · last active ${when(s.updatedAt)} · ${s.messageCount} messages`)
    .join("\n") + (all.length > shown.length ? `\n…and ${all.length - shown.length} more (narrow with folder or query)` : "");
}

interface Msg {
  role: "user" | "assistant";
  at: string;
  text: string;
  tools: string[];
}

// The conversation as text: what you and Claude said, and which tools it used (not their output).
async function readMessages(file: string): Promise<Msg[]> {
  const out: Msg[] = [];
  for (const line of (await fs.readFile(file, "utf8")).split("\n")) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    let ev: any;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if ((ev.type !== "user" && ev.type !== "assistant") || ev.isSidechain || ev.isMeta) continue;
    const c = ev.message?.content;
    const parts = typeof c === "string" ? [{ type: "text", text: c }] : Array.isArray(c) ? c : [];
    const text = parts
      .filter((p: any) => p.type === "text" && typeof p.text === "string")
      .map((p: any) => p.text)
      .join("\n")
      .replace(/<(command-[\w-]+|local-command-stdout|system-reminder)>[\s\S]*?<\/\1>/g, "")
      .trim();
    const tools = parts.filter((p: any) => p.type === "tool_use").map((p: any) => String(p.name));
    if (!text && !tools.length) continue;
    const last = out.at(-1);
    // One reply comes as several lines; keep it as one message.
    if (last && last.role === ev.type && ev.type === "assistant") {
      if (text) last.text = [last.text, text].filter(Boolean).join("\n\n");
      last.tools.push(...tools);
    } else out.push({ role: ev.type, at: String(ev.timestamp ?? ""), text, tools });
  }
  return out;
}

async function fileFor(b: Bot, id: string) {
  const s = (await sessionsFor(b)).find((x) => x.id === id);
  if (!s) return null;
  const f = await findSessionFile(id);
  return f ? { s, file: f.file } : null;
}

const format = (m: Msg) => `## ${m.role === "user" ? "User" : "Claude"} · ${when(m.at)}\n${m.text}${m.tools.length ? `\n(used ${[...new Set(m.tools)].join(", ")})` : ""}`;

export async function readSessionText(b: Bot, o: { id: string; last?: number; before?: number }) {
  const f = await fileFor(b, o.id);
  if (!f) return "You can't read that session (not in your allowed folders, or it doesn't exist). Use list_sessions.";
  const msgs = await readMessages(f.file);
  const end = Math.min(o.before ?? msgs.length, msgs.length);
  const start = Math.max(0, end - Math.min(o.last ?? 40, 200));
  let body = msgs.slice(start, end).map(format).join("\n\n");
  if (body.length > MAX_CHARS) body = `…(trimmed)\n${body.slice(-MAX_CHARS)}`;
  const head = `${f.s.title} · ${home(f.s.cwd)} · ${f.s.active ? "running" : "ended"} · messages ${start + 1}–${end} of ${msgs.length}${start > 0 ? ` (earlier: before=${start})` : ""}`;
  return `${head}\n\n${body || "(nothing said yet)"}`;
}

export async function searchSessionsText(b: Bot, o: { query: string; folder?: string; limit?: number }) {
  const words = o.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return "Give a word or phrase to search for.";
  let all = await sessionsFor(b);
  if (o.folder) all = all.filter((s) => s.cwd && inside(s.cwd, expand(o.folder!)));
  const limit = Math.min(o.limit ?? 20, 50);
  const hits: string[] = [];
  for (const s of all.slice(0, 300)) {
    if (hits.length >= limit) break;
    const f = await findSessionFile(s.id);
    if (!f) continue;
    const msgs = await readMessages(f.file).catch(() => [] as Msg[]);
    for (const [i, m] of msgs.entries()) {
      const low = m.text.toLowerCase();
      if (!words.every((w) => low.includes(w))) continue;
      const at = low.indexOf(words[0]);
      const snip = m.text.slice(Math.max(0, at - 120), at + 200).replace(/\s+/g, " ");
      hits.push(`${s.id} · ${s.title} · ${home(s.cwd)} · ${s.active ? "running" : "ended"} · message ${i + 1} (${m.role}, ${when(m.at)})\n  …${snip}…`);
      if (hits.length >= limit) break;
    }
  }
  return hits.length ? hits.join("\n") : `Nothing about "${o.query}" in the sessions you may read.`;
}

// Claude Code's memory files for the projects you allowed: ~/.claude/projects/<project>/memory/*.md
export async function readMemoryText(b: Bot, o: { folder?: string }) {
  const byDir = new Map<string, string>(); // project dir name -> its folder
  for (const s of await sessionsFor(b)) if (s.cwd && !byDir.has(s.projectDir)) byDir.set(s.projectDir, s.cwd);
  const withMemory: { dir: string; cwd: string; files: string[] }[] = [];
  for (const [dir, cwd] of byDir) {
    const files = (await fs.readdir(path.join(PROJECTS_DIR, dir, "memory")).catch(() => [] as string[])).filter((f) => f.endsWith(".md"));
    if (files.length) withMemory.push({ dir, cwd, files });
  }
  if (!o.folder) {
    if (!withMemory.length) return "None of the folders you may read have memory files.";
    return withMemory.map((m) => `${home(m.cwd)}: ${m.files.join(", ")}`).join("\n") + "\n\nCall read_memory with a folder to read one.";
  }
  const want = expand(o.folder);
  const m = withMemory.find((x) => x.cwd === want || x.dir === encode(want)) ?? withMemory.find((x) => x.cwd.endsWith(`/${o.folder!.replace(/^\/+|\/+$/g, "")}`));
  if (!m) return `No memory files for ${o.folder} in the folders you may read.`;
  const texts = await Promise.all(m.files.map(async (f) => `### ${f}\n${(await fs.readFile(path.join(PROJECTS_DIR, m.dir, "memory", f), "utf8").catch(() => "")).trim()}`));
  const body = texts.join("\n\n");
  return `${home(m.cwd)} memory\n\n${body.length > MAX_CHARS ? `${body.slice(0, MAX_CHARS)}\n…(trimmed)` : body}`;
}
