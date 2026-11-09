import "server-only";
import os from "node:os";
import { buildFromFile, changesBetween, type Change, type FileError, readBotFile } from "./botFile";
import { cleanPatch } from "./botConfig";
import { tryList } from "./botWatch";
import { createBot, getBot, updateBot } from "./bots";
import { isModel } from "./models";
import { isPermissionMode } from "./modes";
import { runClaudeOnce } from "./runClaude";
import { ABILITIES } from "./botAbilities";
import type { Bot } from "./types";

// Check, apply and draft a bot's file (bot.md, lib/botFile.ts). Nothing changes
// until you apply, and applying is always your click on its Configuration page.

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

async function check(text: string, bot: Bot | null): Promise<FileCheck & { patch?: Partial<Bot> }> {
  const { file, errors } = readBotFile(text);
  if (!file) return { ok: false, errors, changes: [], runs: [], apps: [] };
  const base = bot ?? EMPTY;
  if (file.model && !isModel(file.model)) errors.push({ line: null, message: `"${file.model}" isn't a model Vlens knows.` });
  if (file.mode && !isPermissionMode(file.mode)) errors.push({ line: null, message: `"${file.mode}" isn't a permission mode.` });
  const { listMcp } = await import("./mcp");
  const all = await listMcp().catch(() => []);
  for (const a of file.apps) if (!all.some((s) => s.name === a)) errors.push({ line: null, message: `"${a}" isn't one of your connectors. Use the exact name, like "claude.ai Slack".` });

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

export async function checkBotFile(text: string, id: string | null): Promise<FileCheck> {
  const bot = id ? await getBot(id) : null;
  if (id && !bot) throw new Error("Bot not found.");
  const { patch: _p, ...c } = await check(text, bot);
  void _p;
  return c;
}

// Applies the file to bot `id`, or creates a new bot from it (id null). Errors stop it;
// a check command that failed doesn't (you saw it, and may fix it later).
export async function applyBotFile(text: string, id: string | null): Promise<{ bot: Bot; check: FileCheck }> {
  let bot = id ? await getBot(id) : null;
  if (id && !bot) throw new Error("Bot not found.");
  const c = await check(text, bot);
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

const GUIDE = (apps: string[]) => `You write a Vlens bot's setup file (bot.md). Reply with ONLY the complete file, no fences, no comments.

Format (Markdown with YAML frontmatter):
---
type: bot
name: Short name
avatar: One letter or emoji
about: One line, what it does
apps: [exact connector names it needs, from this list only: ${apps.join(", ") || "none"}]
---

## When
- every N min: short name          (N >= 5; a schedule)
  check: \`a shell command that prints one JSON object per line: {"key","title","url","version"?}\`
  brief: |
    What to do with each item. Use {key} {title} {url} {version}.
- when a session ends in ~/folder: short name      (or "starts", or "goes idle for 30 min"; "in all folders" works too)
  brief: |
    What to do. Use {title} {session} {folder}.
(If nothing should wake it up, write: - only when you message it)

## Think
- One sentence per line: where it looks for information.

## Act
- One sentence per line: what it does.

## May do
- One line per action, from this list, each "on its own", "ask me" or "never":
${ABILITIES.map((a) => `  - ${a.label}`).join("\n")}
- Other rules exactly like: - allow: \`Bash(ls:*)\`  /  - ask: \`Bash(gh api:*)\`  /  - never: \`Bash(rm:*)\`

## Knows
- brain: off   (the shared Vlens brain: off, read only, or read and remember; "read only" suits most bots)
- sessions: off   (or ~/folder, ~/other, or all)
- confluence: 12345 Page title   (only page ids you were given)
- skills: all

## Off limits
- One per line: things it must never touch. Paths here are blocked for real.

## Operations
Its playbook in plain words: how it does the job, step by step.

Rules:
- Start careful: anything that posts, sends, merges, pushes or edits is "ask me" unless the user clearly asked otherwise.
- GitHub works through the gh CLI (no connector needed). For check commands prefer gh search / gh api with --jq printing one JSON object per line.
- Keep everything the user didn't ask to change exactly as it is.`;

export async function draftBotFile(o: { instruction: string; current?: string }): Promise<string> {
  const { listMcp } = await import("./mcp");
  const apps = (await listMcp().catch(() => [])).map((s) => s.name);
  const prompt = `${GUIDE(apps)}\n\n${o.current ? `The current file:\n\n${o.current}\n\nChange it as the user asks:` : "Write a new bot for this:"}\n\n${o.instruction.trim()}`;
  const r = await runClaudeOnce({ prompt, args: ["--model", "sonnet", "--tools", "", "--no-session-persistence"], cwd: os.homedir(), timeoutMs: 180_000 });
  if (!r.ok || !r.text.trim()) throw new Error(r.error || "Claude didn't write a file.");
  // In case it fenced it anyway.
  const t = r.text.trim().replace(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/m, "$1").trim();
  const start = t.indexOf("---");
  return (start > 0 ? t.slice(start) : t) + "\n";
}
