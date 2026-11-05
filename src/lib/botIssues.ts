import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { botDir, commitBot } from "./bots";

// A bot's issues: one OKF note per Jira issue or PR it works on, at
// knowledge/issues/<KEY>.md. The note is the issue's memory (what it is, where it
// stands, decisions, open questions, a timeline) and also its card: the
// frontmatter links it to the thread (a session) where the bot works on it.
// Plain files, so you, other agents and your own scripts can read and write them.

export interface IssueMeta {
  key: string; // XPAN-123, PR-2068…
  title: string;
  status: string; // the bot's own word for it: open, in-progress, ready-for-qa, done…
  thread: string | null; // the session id of its thread
  sources: string[]; // jira:XPAN-123, confluence:88412, session:<id>, url…
  related: string[]; // other notes, like decisions/token-check
  updated: string;
}
export interface Issue extends IssueMeta {
  file: string; // issues/XPAN-123.md, relative to knowledge/
  body: string;
}

export const SECTIONS = ["Summary", "Decisions", "Open questions", "Timeline", "Links"] as const;
// Its own sections too (like "Draft review"); these are the ones every note starts with.
export type Section = string;
export const isSection = (s: string) => /^[A-Za-z][\w ,'-]{0,39}$/.test(s);

const KEY = /^[A-Za-z0-9][A-Za-z0-9_.#-]{0,59}$/;
export const isIssueKey = (k: unknown): k is string => typeof k === "string" && KEY.test(k);
const fileFor = (key: string) => `issues/${key.replace(/[^\w.-]/g, "-")}.md`;
const abs = (botId: string, file: string) => path.join(botDir(botId), "knowledge", file);
const today = () => new Date().toISOString().slice(0, 10);
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

function parse(file: string, text: string): Issue | null {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return null;
  let fm: Record<string, unknown>;
  try {
    fm = (yaml.load(m[1]) as Record<string, unknown>) ?? {};
  } catch {
    return null;
  }
  if (fm.type !== "issue" || !isIssueKey(String(fm.key ?? ""))) return null;
  return {
    file,
    key: String(fm.key),
    title: String(fm.title ?? fm.key),
    status: String(fm.status ?? "open"),
    thread: typeof fm.thread === "string" && fm.thread ? fm.thread : null,
    sources: list(fm.sources),
    related: list(fm.related),
    updated: String(fm.updated ?? ""),
    body: m[2],
  };
}

function render(i: Issue) {
  const fm = { type: "issue", key: i.key, title: i.title, status: i.status, thread: i.thread ?? "", sources: i.sources, related: i.related, updated: i.updated };
  return `---\n${yaml.dump(fm, { lineWidth: 200 }).trimEnd()}\n---\n${i.body.startsWith("\n") ? "" : "\n"}${i.body.trimEnd()}\n`;
}

export async function listIssues(botId: string): Promise<Issue[]> {
  const dir = abs(botId, "issues");
  const names = await fs.readdir(dir).catch(() => [] as string[]);
  const all = await Promise.all(
    names.filter((n) => n.endsWith(".md")).map(async (n) => parse(`issues/${n}`, await fs.readFile(path.join(dir, n), "utf8").catch(() => ""))),
  );
  return all.filter((i): i is Issue => !!i).sort((a, b) => b.updated.localeCompare(a.updated) || a.key.localeCompare(b.key));
}

export async function getIssue(botId: string, key: string): Promise<Issue | null> {
  if (!isIssueKey(key)) return null;
  const file = fileFor(key);
  return parse(file, await fs.readFile(abs(botId, file), "utf8").catch(() => ""));
}

export const issueByThread = async (botId: string, sessionId: string) => (await listIssues(botId)).find((i) => i.thread === sessionId) ?? null;

async function save(botId: string, i: Issue, message: string | null) {
  await fs.mkdir(path.dirname(abs(botId, i.file)), { recursive: true });
  await fs.writeFile(abs(botId, i.file), render(i));
  if (message) await commitBot(botId, message);
}

// The issue's note, made with empty sections if it's new.
export async function ensureIssue(botId: string, key: string, title: string): Promise<Issue> {
  if (!isIssueKey(key)) throw new Error(`"${key}" isn't an issue key like XPAN-123.`);
  const had = await getIssue(botId, key);
  if (had) return had;
  const i: Issue = { file: fileFor(key), key, title: title.trim().slice(0, 200) || key, status: "open", thread: null, sources: [], related: [], updated: today(), body: `\n${SECTIONS.map((s) => `## ${s}\n`).join("\n")}` };
  await save(botId, i, `Start issue ${key}`);
  return i;
}

// Bookkeeping (its thread, its status): written, committed with the next change.
export async function setIssueMeta(botId: string, key: string, patch: Partial<Pick<IssueMeta, "thread" | "status" | "title">>) {
  const i = await getIssue(botId, key);
  if (!i) return;
  await save(botId, { ...i, ...patch }, null);
}

// What the bot learned, into one section: replace it, or add a line (Timeline lines get today's date).
export async function updateIssue(
  botId: string,
  key: string,
  u: { section: Section; text: string; mode: "replace" | "append"; status?: string; sources?: string[]; related?: string[] },
) {
  const i = await getIssue(botId, key);
  if (!i) throw new Error(`No issue ${key}. Open it first.`);
  if (!isSection(u.section)) throw new Error(`"${u.section}" isn't a section name.`);
  const text = u.text.trim();
  const line = u.section === "Timeline" && u.mode === "append" && !/^-?\s*\d{4}-\d{2}-\d{2}/.test(text) ? `- ${today()}: ${text.replace(/^-\s*/, "")}` : text;
  const head = `## ${u.section}`;
  const parts = i.body.split(/^(?=## )/m);
  const at = parts.findIndex((p) => p.startsWith(`${head}\n`) || p.trimEnd() === head);
  const block = (old: string) => {
    const content = old.slice(head.length).trim();
    const next = u.mode === "replace" ? line : [content, line.startsWith("-") ? line : `- ${line}`].filter(Boolean).join("\n");
    return `${head}\n\n${next}\n\n`;
  };
  if (at >= 0) parts[at] = block(parts[at]);
  else parts.push(block(head));
  const merged = (a: string[], b?: string[]) => [...new Set([...a, ...(b ?? [])].map((s) => s.trim()).filter(Boolean))].slice(0, 50);
  await save(
    botId,
    { ...i, body: `\n${parts.map((p) => p.trim()).filter(Boolean).join("\n\n")}\n`, status: u.status?.trim() || i.status, sources: merged(i.sources, u.sources), related: merged(i.related, u.related), updated: today() },
    `Update ${key}: ${u.section}`,
  );
}
