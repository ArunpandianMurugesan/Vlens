/* eslint-disable @typescript-eslint/no-explicit-any -- parses untyped CLI JSON lines */
import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withoutPastes } from "./pasted";
import { parseWorktree } from "./worktree";
import { archivedSessions } from "./archive";
import type { Block, ChatMessage, ContextUsage, SessionDetail, SessionSummary } from "./types";
import { activeSessions } from "./active";
import { contextWindowFor, getLimits } from "./limits";
import { pinnedIds } from "./pins";
import { recentSessions } from "./recent";
import { subThreadSessionIds } from "./threads";

export const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

const SESSION_FILE = /^[0-9a-f-]{36}\.jsonl$/;

// "-Users-am-Desktop-claude-lens" -> "claude-lens"
// The session's folder: the one Claude Code files it under (its project dir is that
// folder's path with every non-alphanumeric turned into "-"). A project renamed
// mid-session (claude-lens -> vlens) then counts as its new folder, not its first one.
function homeCwd(dir: string, p: Pick<Parsed, "cwd" | "cwds">) {
  const enc = (c: string) => c.replace(/[^a-zA-Z0-9]/g, "-");
  return p.cwds.find((c) => enc(c) === dir) ?? p.cwd;
}

function projectNameFromDir(dir: string, cwd: string | null) {
  const wt = parseWorktree(cwd);
  if (wt) return `${path.basename(wt.repo)} ⎇ ${wt.name}`; // a session in its own worktree
  if (cwd) return path.basename(cwd) || cwd;
  const parts = dir.split("-").filter(Boolean);
  return parts[parts.length - 1] ?? dir;
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((c) => (c?.type === "text" ? c.text : c?.type === "image" ? "[image]" : ""))
      .join("\n");
  return "";
}

// Text Claude Code injects into user turns that isn't something the human typed.
function isNoise(text: string) {
  const t = text.trim();
  return (
    t.startsWith("<command-") ||
    t.startsWith("<local-command") ||
    t.startsWith("<system-reminder>") ||
    t.startsWith("Caveat: The messages below") ||
    t.startsWith("[Request interrupted")
  );
}

// A slash command you ran is stored as <command-name>/x</command-name> plus
// <command-args>; show it as you typed it.
function commandText(text: string): string | null {
  const name = text.match(/<command-name>([^<]*)<\/command-name>/)?.[1]?.trim();
  if (!name) return null;
  const args = text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
  return `${name.startsWith("/") ? name : `/${name}`}${args ? ` ${args}` : ""}`;
}

// What a slash command printed, from a `system/local_command` line.
function commandOutput(content: unknown): string | null {
  if (typeof content !== "string") return null;
  const out = content.match(/<local-command-std(?:out|err)>([\s\S]*?)<\/local-command-std(?:out|err)>/g);
  const text = (out ?? []).map((t) => t.replace(/<\/?local-command-std(?:out|err)>/g, "")).join("\n").trim();
  return text || null;
}

// "Agent "x" finished" from a <task-notification>, without the XML around it.
function noticeText(text: string) {
  const summary = text.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.trim();
  const status = text.match(/<status>([^<]*)<\/status>/)?.[1]?.trim();
  return summary || `Background task ${status ?? "updated"}`;
}

// `!cmd` turns in the CLI are stored as <bash-input>/<bash-stdout> tags; show them as a shell block.
function shellToMarkdown(text: string) {
  if (!text.includes("<bash-")) return text;
  const unescape = (s: string) =>
    s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
  const tag = (name: string) =>
    unescape(text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1]?.trim() ?? "");
  const lines = [tag("bash-input") && `$ ${tag("bash-input")}`, tag("bash-stdout"), tag("bash-stderr")].filter(Boolean);
  return "```\n" + lines.join("\n") + "\n```";
}

// imageSrc(n) gives the URL for the n-th image in this content, if we can serve it.
function toBlocks(content: unknown, imageSrc?: (n: number) => string): Block[] {
  let images = 0;
  if (typeof content === "string") {
    const cmd = commandText(content);
    if (cmd) return [{ kind: "text", text: cmd }];
    return isNoise(content) ? [] : [{ kind: "text", text: shellToMarkdown(content) }];
  }
  if (!Array.isArray(content)) return [];
  const out: Block[] = [];
  for (const c of content) {
    switch (c?.type) {
      case "text":
        if (c.text && commandText(c.text)) out.push({ kind: "text", text: commandText(c.text)! });
        else if (c.text && !isNoise(c.text)) out.push({ kind: "text", text: shellToMarkdown(c.text) });
        break;
      case "thinking":
        if (c.thinking) out.push({ kind: "thinking", text: c.thinking });
        break;
      case "tool_use":
        out.push({ kind: "tool_use", id: c.id, name: c.name, input: c.input });
        break;
      case "tool_result":
        out.push({
          kind: "tool_result",
          toolUseId: c.tool_use_id,
          text: textOf(c.content),
          isError: !!c.is_error,
        });
        break;
      case "image":
        out.push({ kind: "image", src: imageSrc?.(images++) });
        break;
    }
  }
  return out;
}

interface Parsed {
  title: string | null;
  aiTitle: string | null;
  customTitle: string | null;
  cwd: string | null;
  firstPrompt: string | null;
  messages: ChatMessage[];
  context: { used: number; model: string | null } | null; // at the last reply
  branch: string | null; // the git branch at the last line
  forkedFrom: string | null; // the parent session, when this is a fork
  cwds: string[]; // every folder it worked in
  firstSessionId: string | null; // the session id on its first line (a copied fork keeps its parent's)
}

function parseJsonl(raw: string, withMessages: boolean, sessionId?: string): Parsed {
  let aiTitle: string | null = null;
  let customTitle: string | null = null;
  let cwd: string | null = null;
  let branch: string | null = null;
  let forkedFrom: string | null = null;
  const cwds = new Set<string>(); // every folder it worked in (a renamed project shows both)
  let firstSessionId: string | null = null;
  let firstPrompt: string | null = null;
  let context: Parsed["context"] = null;
  const messages: ChatMessage[] = [];

  for (const line of raw.split("\n")) {
    if (!line) continue;
    let d: any;
    try {
      d = JSON.parse(line);
    } catch {
      continue;
    }
    if (d.type === "ai-title") aiTitle = d.aiTitle;
    else if (d.type === "custom-title") customTitle = d.customTitle;
    if (!cwd && d.cwd) cwd = d.cwd;
    if (typeof d.cwd === "string" && cwds.size < 100) cwds.add(d.cwd);
    if (typeof d.gitBranch === "string" && d.gitBranch) branch = d.gitBranch;
    if (!forkedFrom && typeof d.forkedFrom?.sessionId === "string") forkedFrom = d.forkedFrom.sessionId;
    if (!firstSessionId && typeof d.sessionId === "string") firstSessionId = d.sessionId;
    // A slash command's printed output (e.g. /context) is its own line type.
    if (withMessages && d.type === "system" && d.subtype === "local_command" && !d.isSidechain) {
      const text = commandOutput(d.content);
      if (text && d.uuid)
        messages.push({ id: d.uuid, parentId: d.parentUuid ?? null, role: "assistant", blocks: [{ kind: "text", text }], timestamp: d.timestamp });
      continue;
    }
    // After /compact (or auto-compact) the history continues from a summary.
    if (withMessages && d.type === "user" && d.isCompactSummary && !d.isSidechain) {
      const text = textOf(d.message?.content);
      if (d.uuid) messages.push({ id: d.uuid, parentId: d.parentUuid ?? null, role: "user", blocks: [{ kind: "compact", text }], timestamp: d.timestamp });
      continue;
    }
    // A message you sent while Claude worked reaches it mid-turn, and is saved as an
    // attachment, not a user line. (Agents' own messages use it too: those start with a tag.)
    if (withMessages && d.type === "attachment" && d.attachment?.type === "queued_command" && d.attachment.commandMode === "prompt" && !d.isSidechain && d.uuid) {
      const text = textOf(d.attachment.prompt);
      if (text.trim() && !text.trimStart().startsWith("<"))
        messages.push({ id: d.uuid, parentId: d.parentUuid ?? null, role: "user", blocks: [{ kind: "text", text }], timestamp: d.timestamp });
      continue;
    }
    if ((d.type !== "user" && d.type !== "assistant") || d.isSidechain || d.isMeta) continue;
    // A background agent or command finished: the CLI hands Claude a <task-notification>
    // as a user turn. Show it as a short note in Claude's reply, not as something you typed.
    if (d.type === "user" && d.origin?.kind === "task-notification") {
      if (withMessages && d.uuid)
        messages.push({ id: d.uuid, parentId: d.parentUuid ?? null, role: "assistant", blocks: [{ kind: "notice", text: noticeText(textOf(d.message?.content)) }], timestamp: d.timestamp });
      continue;
    }

    const content = d.message?.content;
    // Tokens sent with the last reply = how much of the context window is in use.
    const u = d.type === "assistant" ? d.message?.usage : null;
    if (u) {
      const used = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
      if (used > 0) context = { used, model: d.message.model ?? null };
    }
    if (!firstPrompt && d.type === "user") {
      const isToolResult = Array.isArray(content) && content.some((c: any) => c?.type === "tool_result");
      const t = textOf(content);
      if (t && !isToolResult) firstPrompt = commandText(t) ?? (isNoise(t) ? null : t);
    }
    if (!withMessages) continue;

    const blocks = toBlocks(
      content,
      sessionId && d.uuid ? (n) => `/api/sessions/${sessionId}/image?m=${d.uuid}&i=${n}` : undefined,
    );
    if (!blocks.length) continue;
    messages.push({
      id: d.uuid,
      parentId: d.parentUuid ?? null,
      role: d.type,
      blocks,
      timestamp: d.timestamp,
    });
  }

  return {
    title: customTitle ?? aiTitle,
    aiTitle,
    customTitle,
    cwd,
    branch,
    forkedFrom,
    cwds: [...cwds],
    firstSessionId,
    firstPrompt,
    context,
    messages: withMessages ? mergeAssistantTurns(messages) : [],
  };
}

// The CLI writes one line per content block, and tool results come back as
// separate "user" lines. Fold those into the assistant turn they belong to so
// the UI shows one bubble per turn, like a normal chat.
function mergeAssistantTurns(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    const onlyToolResults = m.role === "user" && m.blocks.every((b) => b.kind === "tool_result");
    if (prev && prev.role === "assistant" && (m.role === "assistant" || onlyToolResults)) {
      prev.blocks.push(...m.blocks);
      continue;
    }
    out.push({ ...m, blocks: [...m.blocks] });
  }
  return out;
}

function withWindow(c: { used: number; model: string | null }, known: Record<string, number>): ContextUsage {
  return { used: c.used, model: c.model, ...contextWindowFor(c.model, c.used, known) };
}

// A fork's parent: the SDK and CLI write `forkedFrom`; the desktop app copies
// the parent's lines, so the first line still carries the parent's id.
function forkParent(p: Parsed, id: string): { forkedFrom?: string } {
  const parent = p.forkedFrom ?? (p.firstSessionId !== id ? p.firstSessionId : null);
  return parent && parent !== id ? { forkedFrom: parent } : {};
}

function summaryTitle(p: Parsed) {
  if (p.title) return p.title;
  if (p.firstPrompt) return withoutPastes(p.firstPrompt).replace(/\s+/g, " ").trim().slice(0, 80);
  return "Untitled session";
}

// Messages per local day, and the time of the last one. A file's mtime isn't
// enough: long sessions span weeks, and the CLI sometimes touches old files.
const DAYS_KEPT = 31;
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function activity(raw: string): { days: Record<string, number>; last: string | null } {
  const since = Date.now() - DAYS_KEPT * 86_400_000;
  const days: Record<string, number> = {};
  let last: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    const ts = line.match(/"timestamp":"([^"]+)"/)?.[1];
    const t = ts ? Date.parse(ts) : NaN;
    if (Number.isNaN(t)) continue;
    // A copy, not the match itself: V8 makes a match a "slice" that keeps the
    // whole file text alive (hundreds of MB for a long session) for as long as
    // the sidebar caches this summary.
    if (!last || ts! > last) last = new Date(t).toISOString();
    if (t < since) continue;
    const key = dayKey(new Date(t));
    days[key] = (days[key] ?? 0) + 1;
  }
  return { days, last };
}

// What the sidebar knows about one session file, read up to `size` bytes. Session
// files only grow (a long one is hundreds of MB, and the open one changes every
// second), so a change reads just the new lines, and a file is read in slices:
// reading whole files, all at once, is what pushed the dev server past its
// memory limit and restarted it (killing every running Claude).
interface FileScan {
  size: number; // bytes read, up to the end of the last whole line
  mtimeMs: number;
  p: Parsed;
  messageCount: number;
  days: Record<string, number>;
  last: string | null;
}
const gs = globalThis as { lensScans?: Map<string, FileScan>; lensScanJobs?: Map<string, Promise<FileScan | null>> };
const scans = (gs.lensScans ??= new Map()); // kept across hot reloads, so an edit doesn't re-read every file
const scanJobs = (gs.lensScanJobs ??= new Map()); // one read per file, however many polls ask at once
const SLICE = 8 * 1024 * 1024;
let reading = 0;
const waiting: (() => void)[] = [];
async function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  if (reading >= 3) await new Promise<void>((r) => waiting.push(r));
  reading++;
  try {
    return await fn();
  } finally {
    reading--;
    waiting.shift()?.();
  }
}

function emptyScan(): FileScan {
  return { size: 0, mtimeMs: 0, p: parseJsonl("", false), messageCount: 0, days: {}, last: null };
}

// Fold the summary of some new lines into what's known: first-seen fields stay,
// last-seen ones move on.
function addLines(s: FileScan, text: string) {
  const n = parseJsonl(text, false);
  const o = s.p;
  const aiTitle = n.aiTitle ?? o.aiTitle;
  const customTitle = n.customTitle ?? o.customTitle;
  s.p = {
    ...o,
    aiTitle,
    customTitle,
    title: customTitle ?? aiTitle,
    cwd: o.cwd ?? n.cwd,
    branch: n.branch ?? o.branch,
    forkedFrom: o.forkedFrom ?? n.forkedFrom,
    cwds: [...new Set([...o.cwds, ...n.cwds])].slice(0, 100),
    firstSessionId: o.firstSessionId ?? n.firstSessionId,
    firstPrompt: o.firstPrompt ?? n.firstPrompt,
    context: n.context ?? o.context,
  };
  s.messageCount += (text.match(/"type":"(user|assistant)"/g) ?? []).length;
  const act = activity(text);
  for (const [k, v] of Object.entries(act.days)) s.days[k] = (s.days[k] ?? 0) + v;
  if (act.last && (!s.last || act.last > s.last)) s.last = act.last;
}

function scanFile(fp: string, size: number, mtimeMs: number): Promise<FileScan | null> {
  const known = scans.get(fp);
  if (known && known.mtimeMs === mtimeMs) return Promise.resolve(known);
  const job = scanJobs.get(fp);
  if (job) return job;
  const p = oneAtATime(async () => {
    const prev = scans.get(fp);
    // A file that got shorter was rewritten: start over.
    const s: FileScan = prev && prev.size <= size ? { ...prev, p: { ...prev.p }, days: { ...prev.days } } : emptyScan();
    const fh = await fs.open(fp, "r");
    try {
      let carry = "";
      let pos = s.size;
      while (pos < size) {
        const buf = Buffer.alloc(Math.min(SLICE, size - pos));
        const { bytesRead } = await fh.read(buf, 0, buf.length, pos);
        if (!bytesRead) break;
        pos += bytesRead;
        // Cut at the last newline (a byte, so never inside a UTF-8 character).
        const nl = buf.lastIndexOf(10, bytesRead - 1);
        if (nl < 0) {
          carry += buf.toString("utf8", 0, bytesRead);
          continue;
        }
        addLines(s, carry + buf.toString("utf8", 0, nl + 1));
        carry = buf.toString("utf8", nl + 1, bytesRead);
        s.size = pos - Buffer.byteLength(carry);
      }
    } finally {
      await fh.close();
    }
    s.mtimeMs = mtimeMs;
    const since = dayKey(new Date(Date.now() - DAYS_KEPT * 86_400_000));
    for (const k of Object.keys(s.days)) if (k < since) delete s.days[k];
    // Fresh copies only, so nothing kept can pin a slice of file text (see activity()).
    const kept: FileScan = JSON.parse(JSON.stringify(s));
    scans.set(fp, kept);
    return kept;
  })
    .catch(() => null)
    .finally(() => scanJobs.delete(fp));
  scanJobs.set(fp, p);
  return p;
}

export async function listSessions(): Promise<SessionSummary[]> {
  const [hidden, active, pins, recent, limits, archived] = await Promise.all([
    subThreadSessionIds(),
    activeSessions(),
    pinnedIds(),
    recentSessions(),
    getLimits(),
    archivedSessions(),
  ]);
  let dirs: string[] = [];
  try {
    dirs = await fs.readdir(PROJECTS_DIR);
  } catch {
    return [];
  }

  const results: SessionSummary[] = [];
  await Promise.all(
    dirs.map(async (dir) => {
      const full = path.join(PROJECTS_DIR, dir);
      let files: string[];
      try {
        files = (await fs.readdir(full)).filter((f) => SESSION_FILE.test(f));
      } catch {
        return;
      }
      await Promise.all(
        files.map(async (file) => {
          const id = file.replace(".jsonl", "");
          if (hidden.has(id)) return;
          const fp = path.join(full, file);
          const stat = await fs.stat(fp);
          const scan = await scanFile(fp, stat.size, stat.mtimeMs);
          if (!scan) return;
          const p = scan.p;
          // Skip empty shells (sessions opened but never used).
          const summary: SessionSummary | null =
            scan.messageCount === 0 && !p.firstPrompt
              ? null
              : {
                  id,
                  projectDir: dir,
                  projectName: projectNameFromDir(dir, homeCwd(dir, p)),
                  cwd: homeCwd(dir, p),
                  title: summaryTitle(p),
                  updatedAt: scan.last ?? stat.mtime.toISOString(),
                  messageCount: scan.messageCount,
                  days: scan.days,
                  ...forkParent(p, id),
                  context: p.context ? { ...p.context, window: 0, estimated: true } : undefined, // window filled in below
                };
          if (summary) results.push(summary);
        }),
      );
    }),
  );

  // A session just opened in a terminal (or the desktop app) has no
  // transcript until its first message, but it's running: list it anyway.
  const listed = new Set(results.map((s) => s.id));
  for (const [id, run] of active)
    if (!listed.has(id) && !run.byLens && !hidden.has(id)) results.push(notStartedYet(id, run));

  return results
    .map((s) => {
      const run = active.get(s.id);
      return {
        ...s,
        active: run && { status: run.status, entrypoint: run.entrypoint, startedAt: run.startedAt, byLens: run.byLens, waitingFor: run.waitingFor },
        pinOrder: pins.includes(s.id) ? pins.indexOf(s.id) : undefined,
        recentAt: recent.get(s.id),
        archivedAt: archived[s.id],
        context: s.context && withWindow(s.context, limits.contextWindows),
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function findSessionFile(id: string): Promise<{ dir: string; file: string } | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const dirs = await fs.readdir(PROJECTS_DIR);
  for (const dir of dirs) {
    const file = path.join(PROJECTS_DIR, dir, `${id}.jsonl`);
    try {
      await fs.access(file);
      return { dir, file };
    } catch {}
  }
  return null;
}

// The summary of a running session that hasn't written its transcript yet.
function notStartedYet(id: string, run: { cwd: string | null; startedAt: number }): SessionSummary {
  return {
    id,
    projectDir: (run.cwd ?? "").replace(/[^A-Za-z0-9]/g, "-"),
    projectName: run.cwd ? path.basename(run.cwd) || run.cwd : "unknown folder",
    cwd: run.cwd,
    title: "New session (no messages yet)",
    updatedAt: new Date(run.startedAt || Date.now()).toISOString(),
    messageCount: 0,
  };
}

// The last few full sessions parsed, newest last.
const g = globalThis as { lensParsedSessions?: Map<string, Parsed & { mtimeMs: number; size: number }> };
const parsedCache = (g.lensParsedSessions ??= new Map());

export async function getSession(id: string): Promise<SessionDetail | null> {
  const found = await findSessionFile(id);
  if (!found) {
    const run = (await activeSessions()).get(id);
    return run && !run.byLens ? { ...notStartedYet(id, run), messages: [] } : null;
  }
  const stat = await fs.stat(found.file);
  // The open session is polled every few seconds, and a long one is tens of MB.
  // Re-parse it only when the file has changed.
  let p = parsedCache.get(found.file);
  if (!p || p.mtimeMs !== stat.mtimeMs || p.size !== stat.size) {
    p = { ...parseJsonl(await fs.readFile(found.file, "utf8"), true, id), mtimeMs: stat.mtimeMs, size: stat.size };
    parsedCache.delete(found.file);
    parsedCache.set(found.file, p);
    if (parsedCache.size > 3) parsedCache.delete(parsedCache.keys().next().value!);
  }
  const { contextWindows } = await getLimits();
  return {
    id,
    projectDir: found.dir,
    projectName: projectNameFromDir(found.dir, homeCwd(found.dir, p)),
    cwd: homeCwd(found.dir, p),
    title: summaryTitle(p),
    updatedAt: stat.mtime.toISOString(),
    messageCount: p.messages.length,
    messages: p.messages,
    branch: p.branch,
    context: p.context ? withWindow(p.context, contextWindows) : undefined,
  };
}
