import "server-only";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import os from "node:os";
import { writeBotFiles } from "./botFile";
import { DATA_DIR } from "./paths";
import type { Bot, BotConcept, BotTrigger } from "./types";

// Bots: Claude Code agents you set up in Vlens, each with its own role, MCP
// servers, output style and knowledge. A bot is a plain folder that Claude
// Code understands, so a chat with it is an ordinary session run in there:
//
//   bots/<id>/bot.json                      what you set in Vlens
//   bots/<id>/CLAUDE.md                     its role, plus how to use its knowledge
//   bots/<id>/.claude/settings.json         which output style it writes in
//   bots/<id>/.claude/output-styles/bot.md  that style
//   bots/<id>/knowledge/**.md               its knowledge, as an OKF bundle (Open
//                                           Knowledge Format: one Markdown file per
//                                           concept, YAML frontmatter on top)
//
// The folder is a git repo, so every digest and edit is a commit you can look back on.

export const BOTS_DIR = path.join(DATA_DIR, "bots");
const TRASH = path.join(DATA_DIR, "trash", "bots");
const ID = /^[a-z0-9-]{1,40}$/;

export const botDir = (id: string) => path.join(BOTS_DIR, id);

// The bot a folder belongs to: a chat started in bots/<id> is that bot's.
export function botIdForCwd(cwd: string | null | undefined): string | null {
  if (!cwd) return null;
  const rel = path.relative(BOTS_DIR, cwd);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  const id = rel.split(path.sep)[0];
  return ID.test(id) ? id : null;
}

const STYLE_PRESETS: Record<string, string> = {
  Short: "Lead with the answer. Keep replies short: a few lines or a small table. Plain words; explain a technical term the first time.",
  Detailed: "Explain the reasoning step by step, with examples. Use headings for long answers.",
  Report: "Write like a short report: summary first, then findings as bullets, then next steps.",
};
export const stylePresets = () => STYLE_PRESETS;

const defaults = (id: string, name: string): Bot => ({
  id,
  name,
  avatar: name.trim()[0]?.toUpperCase() || "B",
  about: "",
  role: `You are ${name}, a helper bot in Vlens.`,
  mode: "default",
  model: "",
  mcp: [],
  style: STYLE_PRESETS.Short,
  sources: { sessionFolders: [] },
  notify: { digestDone: true, digestFailed: true },
  rules: { allowed: [], lookAt: [], dontLookAt: [] },
  cursor: {},
  createdAt: new Date().toISOString(),
  dir: botDir(id),
});

const exists = (p: string) => fs.access(p).then(() => true, () => false);
const git = (dir: string, args: string[]) => promisify(execFile)("git", ["-C", dir, ...args], { timeout: 15_000 }).catch(() => null);

// The fixed part of every bot's CLAUDE.md: where its knowledge is and how to use it.
const KNOWLEDGE_RULES = `
## Your knowledge

Your knowledge base is the folder \`knowledge/\` here, an OKF bundle: one Markdown
file per concept (a decision, topic, person, project, PR, playbook…), with YAML
frontmatter on top (\`type\`, \`title\`, \`sources\`, \`updated\`). The file's path is
the concept's name.

- Before answering, check the index below. Read every file that may apply,
  even when you think you know the answer: your knowledge is what matters here.
- Read notes with the Read and Grep tools (not Bash), so nobody is asked for permission.
- Cite the files you used, like \`knowledge/decisions/kb-batching.md\`.
- If your knowledge doesn't cover it, say so, then answer as best you can.
`;

// What's in the bundle, in its CLAUDE.md, so the bot knows what to read
// without searching first. Rewritten whenever the knowledge changes.
async function knowledgeIndex(id: string) {
  // Issue notes can be many; they're read one at a time (botIssues.ts), not listed here.
  const all = (await listConcepts(id)).filter((c) => !c.path.startsWith("issues/"));
  if (!all.length) return "\n### Index\n\n(empty so far)\n";
  const lines = all.slice(0, 300).map((c) => `- \`knowledge/${c.path}\`: ${c.title}${c.type ? ` (${c.type})` : ""}`);
  return `\n### Index\n\n${lines.join("\n")}${all.length > 300 ? `\n- …and ${all.length - 300} more (use Grep)` : ""}\n`;
}

// Its rules, which you set in its setup: what it may do, where to look, what's off
// limits. They go at the top of its CLAUDE.md (always read), as OKF notes in
// knowledge/rules/, and the off-limits folders and files also as Claude Code
// deny rules, so it can't read or change them even if it tried.
const rulesOf = (b: Bot) => ({ allowed: b.rules?.allowed ?? [], lookAt: b.rules?.lookAt ?? [], dontLookAt: b.rules?.dontLookAt ?? [] });

function rulesSection(b: Bot) {
  const r = rulesOf(b);
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  const parts = [
    r.allowed.length && `### Allowed: what you may do\n\n${list(r.allowed)}\n\nAnything not listed here: ask first.`,
    r.lookAt.length && `### Look at: where your knowledge comes from\n\n${list(r.lookAt)}`,
    r.dontLookAt.length && `### Don't look at: off limits, never read, use or mention\n\n${list(r.dontLookAt)}`,
  ].filter(Boolean);
  return parts.length ? `\n## Your rules\n\nFollow these exactly; they come before anything else here.\n\n${parts.join("\n\n")}\n` : "";
}

// Confluence pages it reads fresh at the start of each chat (its Settings, Knowledge).
function pagesSection(b: Bot) {
  const pages = b.knowledge?.confluence ?? [];
  if (!pages.length) return "";
  return `\n## Read first\n\nAt the start of each chat, read these Confluence pages with your Confluence connector (they change, so read them fresh; don't rely on memory):\n\n${pages.map((p) => `- ${p.title ? `${p.title}: ` : ""}page ${p.id}`).join("\n")}\n`;
}

const claudeMd = async (b: Bot) => `# ${b.name}\n\n${b.role.trim()}\n${rulesSection(b)}${pagesSection(b)}${KNOWLEDGE_RULES}${await knowledgeIndex(b.id)}`;

// Its own Claude Code settings (.claude/settings.json in its folder), from what you set:
// output style, permissions, hooks, and which plugins are on for it.
function settingsJson(b: Bot) {
  const deny = [...denyRules(b), ...(b.denyTools ?? [])];
  const hooks: Record<string, { matcher?: string; hooks: { type: "command"; command: string }[] }[]> = {};
  for (const h of b.hooks ?? []) if (h.on && h.command.trim()) (hooks[h.event] ??= []).push({ ...(h.matcher ? { matcher: h.matcher } : {}), hooks: [{ type: "command", command: h.command }] });
  return {
    outputStyle: "Bot style",
    ...(deny.length || b.allowTools?.length || b.askTools?.length || b.denyTools?.length ? { permissions: { ...(b.allowTools?.length ? { allow: b.allowTools } : {}), ...(b.askTools?.length ? { ask: b.askTools } : {}), deny } } : {}),
    ...(Object.keys(hooks).length ? { hooks } : {}),
    ...(b.plugins && Object.keys(b.plugins).length ? { enabledPlugins: b.plugins } : {}),
  };
}

// Its triggers. A bot from before triggers had one "watch": that's its first.
export function triggersOf(b: Bot): BotTrigger[] {
  if (b.triggers) return b.triggers;
  const w = b.watch;
  if (!w?.command.trim()) return [];
  return [{ id: "watch", name: "watch", on: w.on, kind: "schedule", everyMinutes: w.everyMinutes, list: w.command, gate: "", event: "ended", idleMinutes: 30, folders: [], match: "", brief: w.brief, updateBrief: w.updateBrief, maxNew: w.maxNew }];
}

// "~/secret", "/Users/x/private", "notes/hr.md" -> deny rules for reading and editing it.
function denyRules(b: Bot) {
  const paths = rulesOf(b).dontLookAt.map((x) => x.trim()).filter((x) => /^(~\/|\/|\.\/)|\.[a-z0-9]{1,6}$|\/$/i.test(x) && !/\s/.test(x));
  const rules: string[] = [];
  for (const raw of paths) {
    const p = raw.startsWith("/") ? `/${raw}` : raw.replace(/^\.\//, ""); // "//abs/path" is an absolute path in Claude Code rules
    const dir = !/\.[a-z0-9]{1,6}$/i.test(raw) || raw.endsWith("/");
    for (const tool of ["Read", "Edit"]) rules.push(`${tool}(${p.replace(/\/$/, "")})`, ...(dir ? [`${tool}(${p.replace(/\/$/, "")}/**)`] : []));
  }
  // Your Claude sessions and their memory: never by reading the files. Only through
  // its session tools (botSessions.ts), when you allow it, for the folders you picked.
  for (const tool of ["Read", "Edit"]) rules.push(`${tool}(~/.claude/projects/**)`, `${tool}(~/.claude/sessions/**)`);
  return rules;
}

const RULE_NOTES: [keyof Bot["rules"], string, string][] = [
  ["allowed", "allowed.md", "Allowed: what it may do"],
  ["lookAt", "look-at.md", "Look at: where its knowledge comes from"],
  ["dontLookAt", "dont-look-at.md", "Don't look at: off limits"],
];

async function writeRuleNotes(b: Bot) {
  const r = rulesOf(b);
  const dir = path.join(botDir(b.id), "knowledge", "rules");
  await fs.mkdir(dir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  for (const [k, file, title] of RULE_NOTES)
    await fs.writeFile(path.join(dir, file), `---\ntype: rule\ntitle: ${title}\nsources: [user]\nupdated: ${today}\n---\n\n# ${title}\n\n${r[k].map((x) => `- ${x}`).join("\n") || "(none yet)"}\n`);
}

async function writeFiles(b: Bot) {
  const dir = botDir(b.id);
  await fs.mkdir(path.join(dir, ".claude", "output-styles"), { recursive: true });
  await fs.mkdir(path.join(dir, "knowledge"), { recursive: true });
  const { dir: _dir, ...saved } = b;
  void _dir;
  await fs.writeFile(path.join(dir, "bot.json"), JSON.stringify(saved, null, 2));
  await writeRuleNotes(b);
  await fs.writeFile(path.join(dir, "CLAUDE.md"), await claudeMd(b));
  await fs.writeFile(
    path.join(dir, ".claude", "output-styles", "bot.md"),
    `---\nname: Bot style\ndescription: How ${b.name.replace(/\n/g, " ")} writes\nkeep-coding-instructions: true\n---\n\n${b.style.trim()}\n`,
  );
  await fs.writeFile(path.join(dir, ".claude", "settings.json"), JSON.stringify(settingsJson(b), null, 2));
  // The bot as two readable files (lib/botFile.ts), like a harness agent: what you
  // read and edit on its Configuration page. The older single bot.md is kept as bot.md.bak.
  const files = writeBotFiles({ ...b, dir }, os.homedir());
  await fs.writeFile(path.join(dir, "agent.yaml"), files.agent);
  await fs.writeFile(path.join(dir, "PLAYBOOK.md"), files.playbook);
  await fs.rename(path.join(dir, "bot.md"), path.join(dir, "bot.md.bak")).catch(() => {});
}

const IGNORED = ["inbox/", "inbox-items/", "state.json", ".spec-check/", "watch-state.json"];

// One commit at a time per bot: its issue threads can save at the same moment,
// and git refuses a second commit while one holds the index.
const commits = new Map<string, Promise<void>>();
function commit(id: string, message: string) {
  const next = (commits.get(id) ?? Promise.resolve()).then(() => doCommit(id, message)).catch(() => {});
  commits.set(id, next);
  return next;
}

async function doCommit(id: string, message: string) {
  const dir = botDir(id);
  // The knowledge may have changed: refresh the index in its CLAUDE.md first.
  const b = await getBot(id);
  if (b) await fs.writeFile(path.join(dir, "CLAUDE.md"), await claudeMd(b));
  if (!(await exists(path.join(dir, ".git")))) await git(dir, ["init", "-q"]);
  // Run state stays out of its history (older bots get the newer entries too).
  const ignore = await fs.readFile(path.join(dir, ".gitignore"), "utf8").catch(() => "");
  const missing = IGNORED.filter((l) => !ignore.split("\n").includes(l));
  if (missing.length) await fs.writeFile(path.join(dir, ".gitignore"), `${ignore}${ignore && !ignore.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
  await git(dir, ["add", "-A"]);
  await git(dir, ["-c", "user.name=Vlens", "-c", "user.email=vlens@localhost", "commit", "-qm", message]);
}

export async function listBots(): Promise<Bot[]> {
  const ids = await fs.readdir(BOTS_DIR).catch(() => [] as string[]);
  const bots = await Promise.all(ids.filter((i) => ID.test(i)).map((i) => getBot(i)));
  const found = bots.filter((b): b is Bot => !!b).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  // For its card: how many notes it knows, and what its bot.yaml watches.
  const { readSpec } = await import("./botSpec");
  return Promise.all(
    found.map(async (b) => {
      const spec = await readSpec(b.dir);
      return {
        ...b,
        notes: (await listConcepts(b.id)).filter((c) => !c.path.startsWith("rules/") && !c.path.startsWith("issues/")).length, // rules and issues are counted on their own
        specTriggers: spec.triggers.map((t) => ({ id: t.id, title: t.title, on: t.on, run: t.run, output: t.output })),
        ...(spec.error ? { specError: spec.error } : {}),
      };
    }),
  );
}

export async function getBot(id: string): Promise<Bot | null> {
  if (!ID.test(id)) return null;
  try {
    const saved = JSON.parse(await fs.readFile(path.join(botDir(id), "bot.json"), "utf8"));
    const b: Bot = { ...defaults(id, saved.name ?? id), ...saved, id, dir: botDir(id) };
    return { ...b, triggers: triggersOf(b) };
  } catch {
    return null;
  }
}

export async function createBot(name: string): Promise<Bot> {
  const clean = name.replace(/\s+/g, " ").trim().slice(0, 60) || "New bot";
  const base = clean.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "bot";
  let id = base;
  while (await exists(botDir(id))) id = `${base}-${randomUUID().slice(0, 4)}`;
  const b = defaults(id, clean);
  await writeFiles(b);
  await commit(id, "Create bot");
  return b;
}

type Patch = Partial<Omit<Bot, "id" | "dir" | "createdAt">>;

export async function updateBot(id: string, patch: Patch): Promise<Bot> {
  const b = await getBot(id);
  if (!b) throw new Error("Bot not found.");
  const next: Bot = { ...b, ...patch, id: b.id, dir: b.dir, createdAt: b.createdAt };
  next.name = next.name.replace(/\s+/g, " ").trim().slice(0, 60) || b.name;
  await writeFiles(next);
  // Settings changes are commits too; cursors and digest notes aren't worth one.
  const settingKeys = Object.keys(patch).filter((k) => k !== "cursor" && k !== "lastDigest");
  if (settingKeys.length) await commit(id, `Change ${settingKeys.join(", ")}`);
  return next;
}

// The bot's folder moves to Vlens's trash, so you can get it back.
export async function deleteBot(id: string) {
  if (!(await getBot(id))) throw new Error("Bot not found.");
  await fs.mkdir(TRASH, { recursive: true });
  await fs.rename(botDir(id), path.join(TRASH, `${id}-${Date.now()}`));
}

// ── Knowledge (the OKF bundle) ──────────────────────────────────────────────

function conceptPath(id: string, rel: string) {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!/^[\w./-]+\.md$/.test(clean) || clean.split("/").some((p) => p === ".." || p === "")) throw new Error("Use a path like decisions/my-decision.md");
  return path.join(botDir(id), "knowledge", clean);
}

// The YAML frontmatter fields we show: just `key: value` lines.
function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const out: Record<string, string> = {};
  for (const line of m?.[1].split("\n") ?? []) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

export async function listConcepts(id: string): Promise<BotConcept[]> {
  const root = path.join(botDir(id), "knowledge");
  const out: BotConcept[] = [];
  async function walk(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".md")) {
        const [text, stat] = await Promise.all([fs.readFile(p, "utf8"), fs.stat(p)]);
        const fm = frontmatter(text);
        out.push({ path: path.relative(root, p).split(path.sep).join("/"), title: fm.title || e.name.replace(/\.md$/, ""), type: fm.type ?? null, updated: fm.updated || stat.mtime.toISOString().slice(0, 10), size: stat.size });
      }
    }
  }
  await walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export const readConcept = async (id: string, rel: string) => fs.readFile(conceptPath(id, rel), "utf8");

export async function writeConcept(id: string, rel: string, text: string) {
  const p = conceptPath(id, rel);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, text);
  await commit(id, `Edit knowledge/${rel}`);
}

export async function deleteConcept(id: string, rel: string) {
  await fs.rm(conceptPath(id, rel));
  await commit(id, `Remove knowledge/${rel}`);
}

// A new concept, with the frontmatter filled in.
export const conceptTemplate = (title: string, type: string) =>
  `---\ntype: ${type}\ntitle: ${title}\nsources: []\nupdated: ${new Date().toISOString().slice(0, 10)}\n---\n\n# ${title}\n\n`;

export { commit as commitBot };

// ── Running a bot ───────────────────────────────────────────────────────────

// The tool name prefix Claude Code gives an MCP server: "claude.ai Google Docs"
// -> "mcp__claude_ai_Google_Docs".
const mcpPrefix = (name: string) => `mcp__${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;

// Args for a `claude` run as this bot: every MCP server you didn't pick is off.
export async function botArgs(b: Bot): Promise<string[]> {
  const { listMcp } = await import("./mcp");
  const all = (await listMcp().catch(() => [])).map((s) => s.name);
  const off = [...new Set(all)].filter((n) => !b.mcp.includes(n)).map(mcpPrefix);
  // One comma-separated value: the flag takes several, and must not swallow the args after it.
  return off.length ? ["--disallowedTools", off.join(",")] : [];
}

// Its picked MCP servers' tools, allowed without asking (a one-off run has nobody to ask).
export const botToolAllow = (b: Bot) => b.mcp.map(mcpPrefix);
