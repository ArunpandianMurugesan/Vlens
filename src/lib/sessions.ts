/* eslint-disable @typescript-eslint/no-explicit-any -- parses untyped CLI JSON lines */
import "server-only";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Block, ChatMessage, SessionDetail, SessionSummary } from "./types";
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

function toBlocks(content: unknown): Block[] {
  if (typeof content === "string")
    return isNoise(content) ? [] : [{ kind: "text", text: shellToMarkdown(content) }];
  if (!Array.isArray(content)) return [];
  const out: Block[] = [];
  for (const c of content) {
    switch (c?.type) {
      case "text":
        if (c.text && !isNoise(c.text)) out.push({ kind: "text", text: shellToMarkdown(c.text) });
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
        out.push({ kind: "image" });
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
}

function parseJsonl(raw: string, withMessages: boolean): Parsed {
  let aiTitle: string | null = null;
  let customTitle: string | null = null;
  let cwd: string | null = null;
  let firstPrompt: string | null = null;
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
    if ((d.type !== "user" && d.type !== "assistant") || d.isSidechain || d.isMeta) continue;

    const content = d.message?.content;
    if (!firstPrompt && d.type === "user") {
      const isToolResult = Array.isArray(content) && content.some((c: any) => c?.type === "tool_result");
      const t = textOf(content);
      if (t && !isNoise(t) && !isToolResult) firstPrompt = t;
    }
    if (!withMessages) continue;

    const blocks = toBlocks(content);
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

function summaryTitle(p: Parsed) {
  if (p.title) return p.title;
  if (p.firstPrompt) return p.firstPrompt.replace(/\s+/g, " ").slice(0, 80);
  return "Untitled session";
}

// Small cache so the sidebar doesn't re-parse hundreds of files every poll.
const summaryCache = new Map<string, { mtimeMs: number; summary: SessionSummary | null }>();

export async function listSessions(): Promise<SessionSummary[]> {
  const hidden = await subThreadSessionIds();
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
                  updatedAt: stat.mtime.toISOString(),
                  messageCount,
                };
          summaryCache.set(fp, { mtimeMs: stat.mtimeMs, summary });
          if (summary) results.push(summary);
        }),
      );
    }),
  );

  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function findSessionFile(id: string): Promise<{ dir: string; file: string } | null> {
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

export async function getSession(id: string): Promise<SessionDetail | null> {
  const found = await findSessionFile(id);
  if (!found) return null;
  const [raw, stat] = await Promise.all([fs.readFile(found.file, "utf8"), fs.stat(found.file)]);
  const p = parseJsonl(raw, true);
  return {
    id,
    projectDir: found.dir,
    projectName: projectNameFromDir(found.dir, p.cwd),
    cwd: p.cwd,
    title: summaryTitle(p),
    updatedAt: stat.mtime.toISOString(),
    messageCount: p.messages.length,
    messages: p.messages,
  };
}
