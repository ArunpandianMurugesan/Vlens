import "server-only";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { buildFromFile, type BotFiles, changesBetween, type Change, type FileError, readBotFiles, readLegacyBotFile, writeBotFiles } from "./botFile";
import { SOURCES } from "./botTriggers";
import { cleanPatch } from "./botConfig";
import { tryList } from "./botWatch";
import { createBot, getBot, updateBot } from "./bots";
import { isModel } from "./models";
import { isPermissionMode } from "./modes";
import { runClaudeOnce } from "./runClaude";
import { ABILITIES } from "./botAbilities";
import type { Bot } from "./types";

// Check, apply and draft a bot's files (agent.yaml + PLAYBOOK.md, lib/botFile.ts).
// Nothing changes until you apply, and applying is always your click on its
// Configuration page (or yours on a change card the bot proposed).

export interface FileCheck {
  ok: boolean; // no errors, and every check command ran
  errors: FileError[];
  changes: Change[];
  runs: { trigger: string; ok: boolean; found?: number; sample?: string[]; error?: string }[];
  apps: { name: string; status: string }[];
}

const EMPTY: Bot = {
  id: "",
  name: "",
  avatar: "",
  about: "",
  role: "",
  mode: "",
  model: "",
  mcp: [],
  style: "",
  sources: { sessionFolders: [] },
  notify: { digestDone: true, digestFailed: true },
  rules: { allowed: [], lookAt: [], dontLookAt: [] },
  cursor: {},
  createdAt: "",
  dir: os.tmpdir(),
};

// A bot's files as they are on disk (written from bot.json if they're missing).
export async function botFilesOf(b: Bot): Promise<BotFiles> {
  const read = (f: string) => fs.readFile(path.join(b.dir, f), "utf8").catch(() => null);
  const [agent, playbook] = await Promise.all([read("agent.yaml"), read("PLAYBOOK.md")]);
  if (agent !== null && playbook !== null) return { agent, playbook };
  return writeBotFiles(b, os.homedir());
}

// Files from a request: both, or (from an older client or bot) the single bot.md text.
export function filesFrom(body: { agent?: unknown; playbook?: unknown; text?: unknown }): BotFiles | null {
  if (typeof body.agent === "string" && typeof body.playbook === "string") return { agent: body.agent, playbook: body.playbook };
  if (typeof body.text === "string") {
    const { file } = readLegacyBotFile(body.text);
    if (!file) return null;
    const built = buildFromFile(file, { triggers: [], mcp: [] }, os.homedir());
    return writeBotFiles({ ...EMPTY, ...built, rules: built.rules ?? EMPTY.rules, role: built.role ?? "" } as Bot, os.homedir());
  }
  return null;
}

async function check(files: BotFiles, bot: Bot | null): Promise<FileCheck & { patch?: Partial<Bot> }> {
  const { file, errors } = readBotFiles(files);
  if (!file) return { ok: false, errors, changes: [], runs: [], apps: [] };
  const base = bot ?? EMPTY;
  if (file.model && !isModel(file.model)) errors.push({ line: null, message: `"${file.model}" isn't a model Vlens knows.` });
  if (file.mode && !isPermissionMode(file.mode)) errors.push({ line: null, message: `"${file.mode}" isn't a permission mode.` });
  const { listMcp } = await import("./mcp");
  const all = await listMcp().catch(() => []);
  for (const a of file.apps) if (!all.some((s) => s.name === a)) errors.push({ file: "agent", line: null, message: `"${a}" isn't one of your connectors. Use the exact name, like "claude.ai Slack".` });
  for (const t of file.when) {
    const need = SOURCES.find((x) => x.id === t.source)?.connector;
    if (need && !file.apps.includes(need)) errors.push({ file: "agent", line: null, message: `"${t.name}" reads through ${need}: add it under connectors.` });
  }

  const built = buildFromFile(file, base, os.homedir());
  const clean = cleanPatch(built as Record<string, unknown>);
  if ("error" in clean) errors.push({ line: null, message: clean.error });
  const patch = "error" in clean ? undefined : clean.patch;

  // Test-run each check that's new or changed (the others already run on their own).
  const was = new Map((base.triggers ?? []).map((t) => [t.id, t.list]));
  const runs: FileCheck["runs"] = [];
  for (const t of patch?.triggers ?? [])
    if (t.kind === "schedule" && t.list.trim() && was.get(t.id) !== t.list) {
      const r = await tryList(t.list, bot?.dir ?? os.homedir());
      runs.push(r.ok ? { trigger: t.name, ok: true, found: r.found, sample: r.sample } : { trigger: t.name, ok: false, error: r.error });
    }
  const apps = file.apps.map((a) => ({ name: a, status: all.find((s) => s.name === a)?.status ?? "unknown" }));
  const changes = patch ? changesBetween(base, patch) : [];
  return { ok: !errors.length && runs.every((r) => r.ok), errors, changes, runs, apps, patch };
}

export async function checkBotFile(files: BotFiles, id: string | null): Promise<FileCheck> {
  const bot = id ? await getBot(id) : null;
  if (id && !bot) throw new Error("Bot not found.");
  const { patch: _p, ...c } = await check(files, bot);
  void _p;
  return c;
}

// Applies the file to bot `id`, or creates a new bot from it (id null). Errors stop it;
// a check command that failed doesn't (you saw it, and may fix it later).
export async function applyBotFile(files: BotFiles, id: string | null): Promise<{ bot: Bot; check: FileCheck }> {
  let bot = id ? await getBot(id) : null;
  if (id && !bot) throw new Error("Bot not found.");
  const c = await check(files, bot);
  if (c.errors.length || !c.patch) throw new Error(c.errors[0]?.message ?? "This file can't be applied.");
  if (!bot) bot = await createBot(c.patch.name || "New bot");
  // Its own summary goes stale when its job changes; it's read from the file until it writes a new one.
  const jobChanged = c.changes.some((x) => /trigger|looks at|every|command|sessions it watches/i.test(x.text));
  const next = await updateBot(bot.id, { ...c.patch, ...(jobChanged ? { job: undefined } : {}) });
  const { patch: _p, ...check2 } = c;
  void _p;
  return { bot: next, check: check2 };
}

// ── Drafting with AI ─────────────────────────────────────────────────────────

const GUIDE = (apps: string[]) => `You write a Vlens bot's two setup files, like a dev-agent-harness agent: agent.yaml (its settings and triggers) and PLAYBOOK.md (what it does when woken). Reply with ONLY the two files, each after a line "=== agent.yaml ===" or "=== PLAYBOOK.md ===", no fences, no comments around them.

agent.yaml (YAML):
name: Short name
avatar: One letter or emoji
about: One line, what it does
connectors: [exact connector names it needs, from this list only: ${apps.join(", ") || "none"}]
may:                      # one line per action, each "on its own", "ask me" or "never":
${ABILITIES.map((a) => `  ${a.label}: ask me`).join("\n")}
rules:                    # optional, other permission rules exactly like these
  allow: ["Bash(ls:*)"]
  ask: ["Bash(gh api:*)"]
  never: ["Bash(rm:*)"]
knows:
  brain: off              # the shared Vlens brain: off, read only, or read and remember ("read only" suits most bots)
  brainFolders: all       # only with the brain on: all, or [~/Desktop/org_repos]
  brainLearns: off        # only with "read and remember": off, all sessions, or [~/folder]
  sessions: off           # your Claude sessions it may read: off, all, or [~/folder]
  confluence: []          # [{ id: 12345, title: Page }], only page ids you were given
  skills: all
offLimits: []             # things it must never touch; paths are blocked for real
limits:                   # optional
  quietHours: "20:00-08:00"
  weekdaysOnly: true
  maxRunsPerDay: 20
on:                       # its triggers; each wakes it for new or changed items only
${SOURCES.map((x) => `  - name: short name\n    source: ${x.id}            # ${x.label}${x.connector ? ` (needs the ${x.connector} connector)` : ""}${(x.params ?? []).map((p) => `\n    ${p.key}: ${p.placeholder ?? "…"}   # ${p.hint}`).join("")}${x.id === "command" ? `\n    every: 15\n    check: 'a shell command printing one JSON object per line: {"key","title","url","version"}'` : ""}${x.id.startsWith("session.") ? "\n    folders: [~/Desktop/org_repos]" : ""}`).join("\n")}
  # Every trigger may also have: paused: true, playbook: <a "## …" part of PLAYBOOK.md>,
  # brief: | what to do with each item ({key} {title} {url} {version} {kind} {session} {folder}),
  # updateBrief: | what to do when an item changed, gate: 'a command (exit 10 skips)', maxNew: 3.
  # Ready-made sources have sensible briefs: leave brief out unless the user wants something specific.

PLAYBOOK.md (Markdown):
# Its name

What it is and how it does the job, step by step, in plain words.

## A part a trigger can follow (e.g. "## Reviewing"), as many as useful

## Where it looks
- One sentence per line: where it finds information.

## What it does
- One sentence per line: what it does.

Rules:
- Start careful: anything that posts, sends, merges, pushes or edits is "ask me" unless the user clearly asked otherwise.
- GitHub works through the gh CLI (no connector needed). Prefer the ready-made github.* sources over a command.
- Keep everything the user didn't ask to change exactly as it is, in both files.`;

export async function draftBotFile(o: { instruction: string; current?: BotFiles }): Promise<BotFiles> {
  const { listMcp } = await import("./mcp");
  const apps = (await listMcp().catch(() => [])).map((s) => s.name);
  const cur = o.current ? `The current files:\n\n=== agent.yaml ===\n${o.current.agent}\n=== PLAYBOOK.md ===\n${o.current.playbook}\n\nChange them as the user asks:` : "Write a new bot for this:";
  const prompt = `${GUIDE(apps)}\n\n${cur}\n\n${o.instruction.trim()}`;
  const r = await runClaudeOnce({ prompt, args: ["--model", "sonnet", "--tools", "", "--no-session-persistence"], cwd: os.homedir(), timeoutMs: 240_000 });
  if (!r.ok || !r.text.trim()) throw new Error(r.error || "Claude didn't write the files.");
  const unfence = (t: string) => t.trim().replace(/^```[a-z]*\n([\s\S]*?)\n```$/m, "$1").trim();
  const m = r.text.match(/=== agent\.yaml ===\s*\n([\s\S]*?)\n=== PLAYBOOK\.md ===\s*\n([\s\S]*)$/);
  if (!m) throw new Error("Claude's answer didn't have both files. Try again, or edit by hand.");
  return { agent: unfence(m[1]) + "\n", playbook: unfence(m[2]) + "\n" };
}
