/* eslint-disable @typescript-eslint/no-explicit-any -- parses untyped CLI JSON lines */
import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Block, ChatMessage, ContextUsage, SessionDetail, SessionSummary } from "./types";
import { activeSessions } from "./active";
import { contextWindowFor, getLimits } from "./limits";
import { pinnedIds } from "./pins";
import { recentSessions } from "./recent";
import { subThreadSessionIds } from "./threads";

export const PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

const SESSION_FILE = /^[0-9a-f-]{36}\.jsonl$/;

// "-Users-am-Desktop-claude-lens" -> "claude-lens"
function projectNameFromDir(dir: string, cwd: string | null) {
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
  cwd: string | null;
  firstPrompt: string | null;
  messages: ChatMessage[];
  context: { used: number; model: string | null } | null; // at the last reply
}

function parseJsonl(raw: string, withMessages: boolean, sessionId?: string): Parsed {
  let aiTitle: string | null = null;
  let customTitle: string | null = null;
  let cwd: string | null = null;
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
    if ((d.type !== "user" && d.type !== "assistant") || d.isSidechain || d.isMeta) continue;

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
    cwd,
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

function summaryTitle(p: Parsed) {
  if (p.title) return p.title;
  if (p.firstPrompt) return p.firstPrompt.replace(/\s+/g, " ").trim().slice(0, 80);
  return "Untitled session";
}

// Small cache so the sidebar doesn't re-parse hundreds of files every poll.
const summaryCache = new Map<string, { mtimeMs: number; summary: SessionSummary | null }>();

// Messages per local day, and the time of the last one. A file's mtime isn't
// enough: long sessions span weeks, and the CLI sometimes touches old files.
const DAYS_KEPT = 31;
function activity(raw: string): { days: Record<string, number>; last: string | null } {
  const since = Date.now() - DAYS_KEPT * 86_400_000;
  const days: Record<string, number> = {};
  let last: string | null = null;
  for (const line of raw.split("\n")) {
    if (!line.includes('"type":"user"') && !line.includes('"type":"assistant"')) continue;
    const ts = line.match(/"timestamp":"([^"]+)"/)?.[1];
    const t = ts ? Date.parse(ts) : NaN;
    if (Number.isNaN(t)) continue;
    if (!last || ts! > last) last = ts!;
    if (t < since) continue;
    const d = new Date(t);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    days[key] = (days[key] ?? 0) + 1;
  }
  return { days, last };
}

export async function listSessions(): Promise<SessionSummary[]> {
  const [hidden, active, pins, recent, limits] = await Promise.all([
    subThreadSessionIds(),
    activeSessions(),
    pinnedIds(),
    recentSessions(),
    getLimits(),
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
          const cached = summaryCache.get(fp);
          if (cached && cached.mtimeMs === stat.mtimeMs) {
            if (cached.summary) results.push(cached.summary);
            return;
          }
          const raw = await fs.readFile(fp, "utf8");
          const p = parseJsonl(raw, false);
          const messageCount = (raw.match(/"type":"(user|assistant)"/g) ?? []).length;
          const act = activity(raw);
          // Skip empty shells (sessions opened but never used).
          const summary: SessionSummary | null =
            messageCount === 0 && !p.firstPrompt
              ? null
              : {
                  id,
                  projectDir: dir,
                  projectName: projectNameFromDir(dir, p.cwd),
                  cwd: p.cwd,
                  title: summaryTitle(p),
                  updatedAt: act.last ?? stat.mtime.toISOString(),
                  messageCount,
                  days: act.days,
                  context: p.context ? { ...p.context, window: 0, estimated: true } : undefined, // window filled in below
                };
          summaryCache.set(fp, { mtimeMs: stat.mtimeMs, summary });
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
        active: run && { status: run.status, entrypoint: run.entrypoint, startedAt: run.startedAt, byLens: run.byLens },
        pinOrder: pins.includes(s.id) ? pins.indexOf(s.id) : undefined,
        recentAt: recent.get(s.id),
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

export async function getSession(id: string): Promise<SessionDetail | null> {
  const found = await findSessionFile(id);
  if (!found) {
    const run = (await activeSessions()).get(id);
    return run && !run.byLens ? { ...notStartedYet(id, run), messages: [] } : null;
  }
  const [raw, stat] = await Promise.all([fs.readFile(found.file, "utf8"), fs.stat(found.file)]);
  const p = parseJsonl(raw, true, id);
  const { contextWindows } = await getLimits();
  return {
    id,
    projectDir: found.dir,
    projectName: projectNameFromDir(found.dir, p.cwd),
    cwd: p.cwd,
    title: summaryTitle(p),
    updatedAt: stat.mtime.toISOString(),
    messageCount: p.messages.length,
    messages: p.messages,
    context: p.context ? withWindow(p.context, contextWindows) : undefined,
  };
}
