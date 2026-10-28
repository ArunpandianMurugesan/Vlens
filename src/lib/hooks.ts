/* eslint-disable @typescript-eslint/no-explicit-any -- settings.json is untyped JSON */
import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { jsonStore } from "./jsonStore";
import type { HookEntry, HookScope } from "./types";

// Hooks live in the CLI's settings files under "hooks":
//   { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": "…" } ] } ] }
// Vlens edits only that key, backs the file up first, and keeps its formatting.
// The CLI has no per-hook off switch, so "off" moves a hook out of the file
// into data/hooks-off.json, and "on" puts it back.

// The events the CLI accepts (taken from the CLI itself).
export const HOOK_EVENTS = [
  "PreToolUse", "PostToolUse", "PostToolUseFailure", "PostToolBatch", "Notification", "UserPromptSubmit",
  "UserPromptExpansion", "SessionStart", "SessionEnd", "Stop", "StopFailure", "SubagentStart", "SubagentStop",
  "PreCompact", "PostCompact", "PreModelSwitch", "PostModelSwitch", "PermissionRequest", "PermissionDenied",
  "Setup", "TeammateIdle", "TaskCreated", "TaskCompleted", "Elicitation", "ElicitationResult", "ConfigChange",
  "WorktreeCreate", "WorktreeRemove", "InstructionsLoaded", "CwdChanged", "FileChanged", "DirectoryAdded",
  "MessageDisplay",
] as const;
const EVENTS = new Set<string>(HOOK_EVENTS);
const TYPES = new Set(["command", "prompt", "agent", "http"]);

const HOME = os.homedir();
const USER_FILE = path.join(HOME, ".claude", "settings.json");
const BACKUPS = path.join(HOME, ".claude", "backups");
const PLUGINS_FILE = path.join(HOME, ".claude", "plugins", "installed_plugins.json");

function fileFor(scope: HookScope, project?: string) {
  if (scope === "user") return USER_FILE;
  if (!project) throw new Error("Pick a project folder first.");
  return path.join(project, ".claude", scope === "project" ? "settings.json" : "settings.local.json");
}

// Hooks other apps install mark themselves; show that so you know before changing them.
function managedBy(hook: any): string | undefined {
  const m = typeof hook?.command === "string" && hook.command.match(/#\s*([a-z0-9-]+)-hook\s*$/i);
  return m ? m[1] : undefined;
}

const idOf = (file: string, event: string, matcher: string | undefined, hook: unknown) =>
  createHash("sha1").update(JSON.stringify([file, event, matcher ?? "", hook])).digest("hex").slice(0, 16);

async function readJson(file: string): Promise<{ data: any; raw: string | null; mtime: number }> {
  try {
    const [raw, st] = await Promise.all([fs.readFile(file, "utf8"), fs.stat(file)]);
    return { data: JSON.parse(raw), raw, mtime: st.mtimeMs };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { data: {}, raw: null, mtime: 0 };
    throw new Error(`Couldn't read ${file}: ${(e as Error).message}`);
  }
}

function flatten(data: any, file: string, scope: HookEntry["scope"], extra: Partial<HookEntry> = {}): HookEntry[] {
  const out: HookEntry[] = [];
  for (const [event, groups] of Object.entries<any[]>(data?.hooks ?? {}))
    for (const g of Array.isArray(groups) ? groups : [])
      for (const hook of Array.isArray(g?.hooks) ? g.hooks : [])
        out.push({ id: idOf(file, event, g.matcher, hook), scope, file, event, matcher: g.matcher, hook, enabled: true, managedBy: managedBy(hook), ...extra });
  return out;
}

// ── Turned-off hooks ───────────────────────────────────────────────────────

interface OffHook {
  scope: HookScope;
  file: string;
  event: string;
  matcher?: string;
  hook: any;
  at: string;
}
const offStore = jsonStore<OffHook[]>("hooks-off.json", () => []);

// ── Reading ────────────────────────────────────────────────────────────────

async function pluginHooks(): Promise<HookEntry[]> {
  const dirs: { dir: string; name: string }[] = [];
  // Plugin folders linked into ~/.claude/skills, and installed plugins.
  for (const e of await fs.readdir(path.join(HOME, ".claude", "skills"), { withFileTypes: true }).catch(() => []))
    if (!e.name.startsWith(".")) dirs.push({ dir: path.join(HOME, ".claude", "skills", e.name), name: e.name });
  try {
    const d = JSON.parse(await fs.readFile(PLUGINS_FILE, "utf8"));
    for (const [id, installs] of Object.entries<{ installPath: string }[]>(d.plugins ?? {}))
      for (const i of installs) dirs.push({ dir: i.installPath, name: id.split("@")[0] });
  } catch {}
  const out: HookEntry[] = [];
  for (const { dir, name } of dirs) {
    const file = path.join(dir, "hooks", "hooks.json");
    const { data } = await readJson(file).catch(() => ({ data: null }));
    if (data) out.push(...flatten(data, file, "plugin", { plugin: name }));
  }
  return out;
}

export async function listHooks(project?: string) {
  const scopes: HookScope[] = project ? ["user", "project", "local"] : ["user"];
  const hooks: HookEntry[] = [];
  for (const scope of scopes) {
    const file = fileFor(scope, project);
    hooks.push(...flatten((await readJson(file)).data, file, scope));
  }
  const files = new Set(scopes.map((s) => fileFor(s, project)));
  for (const h of await offStore.load())
    if (files.has(h.file))
      hooks.push({ id: idOf(h.file, h.event, h.matcher, h.hook), scope: h.scope, file: h.file, event: h.event, matcher: h.matcher, hook: h.hook, enabled: false, managedBy: managedBy(h.hook) });
  hooks.push(...(await pluginHooks()));
  const disableAll = !!(await readJson(USER_FILE)).data.disableAllHooks;
  return { hooks, disableAll, events: HOOK_EVENTS };
}

// ── Writing ────────────────────────────────────────────────────────────────

// Read-modify-write of one settings file, touching only what `fn` changes.
async function editSettings(file: string, fn: (data: any) => void) {
  const { data, raw, mtime } = await readJson(file);
  fn(data);
  if (data.hooks && !Object.keys(data.hooks).length) delete data.hooks;

  // If the CLI (or you) changed the file while we worked, don't overwrite that.
  const now = await fs.stat(file).then((s) => s.mtimeMs, () => 0);
  if (now !== mtime) throw new Error("The settings file just changed. Refresh and try again.");

  if (raw !== null) {
    await fs.mkdir(BACKUPS, { recursive: true });
    const tag = file === USER_FILE ? "settings.json" : file.replace(/[/\\]/g, "_").replace(/^_+/, "");
    await fs.writeFile(path.join(BACKUPS, `${tag}.lens-backup.${Date.now()}`), raw, { mode: 0o600 });
    await pruneBackups(tag);
  }
  await fs.mkdir(path.dirname(file), { recursive: true });
  const mode = await fs.stat(file).then((s) => s.mode & 0o777, () => 0o600);
  const tmp = `${file}.lens-tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", { mode });
  await fs.rename(tmp, file);
}

async function pruneBackups(tag: string) {
  const mine = (await fs.readdir(BACKUPS)).filter((f) => f.startsWith(`${tag}.lens-backup.`)).sort();
  for (const f of mine.slice(0, -5)) await fs.unlink(path.join(BACKUPS, f)).catch(() => {});
}

function insert(data: any, event: string, matcher: string | undefined, hook: any) {
  data.hooks ??= {};
  data.hooks[event] ??= [];
  const groups: any[] = data.hooks[event];
  const g = groups.find((x) => (x.matcher ?? "") === (matcher ?? ""));
  if (g) g.hooks.push(hook);
  else groups.push(matcher ? { matcher, hooks: [hook] } : { hooks: [hook] });
}

// Removes the hook with this id from the data; returns it, or throws if it's gone.
function take(data: any, file: string, id: string): { event: string; matcher?: string; hook: any } {
  for (const [event, groups] of Object.entries<any[]>(data.hooks ?? {}))
    for (const [gi, g] of groups.entries())
      for (const [hi, hook] of (g.hooks ?? []).entries())
        if (idOf(file, event, g.matcher, hook) === id) {
          g.hooks.splice(hi, 1);
          if (!g.hooks.length) groups.splice(gi, 1);
          if (!groups.length) delete data.hooks[event];
          return { event, matcher: g.matcher, hook };
        }
  throw new Error("That hook changed since you opened it. Refresh and try again.");
}

// Checks a hook object from the UI.
export function cleanHook(h: any): any {
  if (!h || typeof h !== "object" || Array.isArray(h)) throw new Error("A hook is a JSON object.");
  if (!TYPES.has(h.type)) throw new Error(`"type" must be one of: ${[...TYPES].join(", ")}.`);
  const need = { command: "command", prompt: "prompt", agent: "prompt", http: "url" }[h.type as string]!;
  if (typeof h[need] !== "string" || !h[need].trim()) throw new Error(`A ${h.type} hook needs "${need}".`);
  if (h.timeout !== undefined && !(Number.isInteger(h.timeout) && h.timeout > 0 && h.timeout <= 3600))
    throw new Error('"timeout" is a whole number of seconds (1 to 3600).');
  return h;
}

function checkEvent(event: string, matcher?: string) {
  if (!EVENTS.has(event)) throw new Error("Pick an event.");
  if (matcher !== undefined && typeof matcher !== "string") throw new Error("Matcher must be text.");
}

export async function addHook(o: { scope: HookScope; project?: string; event: string; matcher?: string; hook: any }) {
  checkEvent(o.event, o.matcher);
  const hook = cleanHook(o.hook);
  const file = fileFor(o.scope, o.project);
  await editSettings(file, (d) => insert(d, o.event, o.matcher?.trim() || undefined, hook));
}

// Finds which editable file an id lives in (on), or the off-store entry.
async function locate(id: string, project?: string) {
  const { hooks } = await listHooks(project);
  const h = hooks.find((x) => x.id === id);
  if (!h) throw new Error("That hook changed since you opened it. Refresh and try again.");
  if (h.scope === "plugin") throw new Error("Plugin hooks are managed by the plugin.");
  return h;
}

export async function updateHook(id: string, o: { matcher?: string; hook: any; project?: string }) {
  const h = await locate(id, o.project);
  const hook = cleanHook(o.hook);
  const matcher = o.matcher?.trim() || undefined;
  if (!h.enabled) {
    await offStore.update((list) => {
      const e = list.find((x) => idOf(x.file, x.event, x.matcher, x.hook) === id);
      if (e) Object.assign(e, { matcher, hook });
    });
    return;
  }
  await editSettings(h.file, (d) => {
    const { event } = take(d, h.file, id);
    insert(d, event, matcher, hook);
  });
}

export async function removeHook(id: string, project?: string) {
  const h = await locate(id, project);
  if (!h.enabled) return offStore.update((list) => void list.splice(list.findIndex((x) => idOf(x.file, x.event, x.matcher, x.hook) === id), 1));
  await editSettings(h.file, (d) => void take(d, h.file, id));
}

export async function setHookEnabled(id: string, on: boolean, project?: string) {
  const h = await locate(id, project);
  if (h.enabled === on) return;
  if (!on) {
    await editSettings(h.file, (d) => void take(d, h.file, id));
    await offStore.update((list) => void list.push({ scope: h.scope as HookScope, file: h.file, event: h.event, matcher: h.matcher, hook: h.hook, at: new Date().toISOString() }));
  } else {
    await editSettings(h.file, (d) => insert(d, h.event, h.matcher, h.hook));
    await offStore.update((list) => void list.splice(list.findIndex((x) => idOf(x.file, x.event, x.matcher, x.hook) === id), 1));
  }
}

// The CLI's own switch that pauses every hook at once.
export async function setDisableAll(on: boolean) {
  await editSettings(USER_FILE, (d) => {
    if (on) d.disableAllHooks = true;
    else delete d.disableAllHooks;
  });
}
