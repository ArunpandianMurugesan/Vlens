import "server-only";
import yaml from "js-yaml";
import { triggersOf } from "./bots";
import { HOOK_EVENTS } from "./hooks";
import { isModel } from "./models";
import { isPermissionMode } from "./modes";
import type { Bot, BotHook, BotTrigger } from "./types";

// A bot's configuration (its Settings page): triggers, knowledge, powers,
// permissions and notifications. The page saves it field by field; "View as
// file" shows the same thing as YAML you can edit by hand. Both go through
// cleanConfig, so a hand edit can't set anything the page couldn't.

const str = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const num = (v: unknown, def: number, lo: number, hi: number) => Math.min(Math.max(Math.round(Number(v) || def), lo), hi);
const strs = (v: unknown, max = 100, len = 500) => (Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max).map((x) => x.slice(0, len)) : []);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
const RULE = /^[\w.*-]+(\(.{1,300}\))?$/;
const EFFORTS = ["", "low", "medium", "high", "xhigh", "max"] as const;
const EVENTS = new Set<string>(HOOK_EVENTS);

export function cleanTrigger(t: Record<string, unknown>, i: number, taken: Set<string>): BotTrigger {
  const name = str(t.name, 60).trim() || `trigger-${i + 1}`;
  let id = slug(str(t.id, 40)) || slug(name) || `t${i + 1}`;
  while (taken.has(id)) id = `${id}-${i + 1}`;
  taken.add(id);
  const kind = t.kind === "session" ? "session" : "schedule";
  const event = t.event === "started" || t.event === "idle" ? t.event : "ended";
  return {
    id,
    name,
    on: !!t.on,
    kind,
    everyMinutes: num(t.everyMinutes, 15, 5, 1440),
    list: str(t.list, 8000),
    gate: str(t.gate, 8000),
    event,
    idleMinutes: num(t.idleMinutes, 30, 5, 1440),
    folders: strs(t.folders, 50).filter((f) => f.startsWith("/")),
    match: str(t.match, 300),
    brief: str(t.brief, 8000),
    updateBrief: str(t.updateBrief, 8000),
    maxNew: num(t.maxNew, 3, 1, 50),
  };
}

export const cleanHook = (h: Record<string, unknown>, i: number): BotHook | null => {
  const event = str(h.event, 40);
  if (!EVENTS.has(event) || !str(h.command, 2000).trim()) return null;
  return { id: slug(str(h.id, 40)) || `h${i + 1}`, on: h.on !== false, event, matcher: str(h.matcher, 200), command: str(h.command, 2000) };
};

// The parts of a PATCH (or a YAML edit) that are configuration. Unknown keys are dropped.
export function cleanConfig(body: Record<string, any>): Partial<Bot> { // eslint-disable-line @typescript-eslint/no-explicit-any -- untrusted input, checked here
  const p: Partial<Bot> = {};
  if (Array.isArray(body.triggers)) {
    const taken = new Set<string>();
    p.triggers = body.triggers.slice(0, 20).map((t: Record<string, unknown>, i: number) => cleanTrigger(t ?? {}, i, taken));
  }
  if (typeof body.effort === "string" && (EFFORTS as readonly string[]).includes(body.effort)) p.effort = body.effort as Bot["effort"];
  if (body.knowledge && typeof body.knowledge === "object")
    p.knowledge = {
      confluence: (Array.isArray(body.knowledge.confluence) ? body.knowledge.confluence : [])
        .map((c: unknown) => (typeof c === "object" && c ? (c as Record<string, unknown>) : { id: c }))
        .map((c: Record<string, unknown>) => ({ id: str(c.id, 40).replace(/\D/g, ""), title: str(c.title, 200) }))
        .filter((c: { id: string }) => c.id)
        .slice(0, 30),
    };
  if (body.skills === null || body.skills === "all") p.skills = null;
  else if (Array.isArray(body.skills)) p.skills = strs(body.skills, 200, 120);
  if (body.plugins && typeof body.plugins === "object" && !Array.isArray(body.plugins)) {
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(body.plugins).slice(0, 200)) if (/^[\w.-]+@[\w.-]+$/.test(k) && typeof v === "boolean") out[k] = v;
    p.plugins = out;
  }
  if (Array.isArray(body.hooks)) p.hooks = body.hooks.slice(0, 30).map((h: Record<string, unknown>, i: number) => cleanHook(h ?? {}, i)).filter((h: BotHook | null): h is BotHook => !!h);
  if (body.notify && typeof body.notify === "object") {
    const n = body.notify;
    p.notify = { digestDone: n.digestDone !== false, digestFailed: n.digestFailed !== false, needsYou: n.needsYou !== false, finished: n.finished !== false, failed: n.failed !== false, mac: !!n.mac };
  }
  const rules = (xs: unknown[]) => xs.map((x) => String(x).trim()).filter((x) => RULE.test(x)).slice(0, 100);
  if (Array.isArray(body.allowTools)) p.allowTools = rules(body.allowTools);
  if (Array.isArray(body.askTools)) p.askTools = rules(body.askTools);
  if (Array.isArray(body.denyTools)) p.denyTools = rules(body.denyTools);
  if (typeof body.autoSaveIssues === "boolean") p.autoSaveIssues = body.autoSaveIssues;
  if (typeof body.paused === "boolean") p.paused = body.paused;
  if (body.brain === "off" || body.brain === "read" || body.brain === "remember") p.brain = body.brain;
  if (body.brainLearn === null) p.brainLearn = undefined;
  else if (body.brainLearn && typeof body.brainLearn === "object") p.brainLearn = { all: !!body.brainLearn.all, folders: strs(body.brainLearn.folders, 30, 300).filter((f) => f.startsWith("/")) };
  if (Array.isArray(body.brainFolders)) p.brainFolders = strs(body.brainFolders, 30, 300).filter((f) => f.startsWith("/"));
  // Its job in plain words (a recipe fills it in; the bot rewrites it with set_job).
  if (body.job && typeof body.job === "object" && [body.job.when, body.job.think, body.job.act].every((x) => typeof x === "string" && x.trim()))
    p.job = { when: str(body.job.when, 300), think: str(body.job.think, 300), act: str(body.job.act, 300), updatedAt: new Date().toISOString() };
  return p;
}

// ── As a file ───────────────────────────────────────────────────────────────

const HEADER = `# This bot's configuration. Edit and save: it's checked the same way as the
# Settings page. Its playbook and notes are edited there.
`;

export function configYaml(b: Bot): string {
  const doc = {
    model: b.model || "default",
    effort: b.effort || "default",
    triggers: triggersOf(b).map(({ id, name, on, kind, everyMinutes, list, gate, event, idleMinutes, folders, match, brief, updateBrief, maxNew }) =>
      kind === "schedule" ? { id, name, on, kind, everyMinutes, list, gate, brief, updateBrief, maxNew } : { id, name, on, kind, event, ...(event === "idle" ? { idleMinutes } : {}), folders, match, gate, brief, updateBrief, maxNew },
    ),
    knowledge: { confluence: b.knowledge?.confluence ?? [], sessions: b.sessionAccess ?? { all: false, folders: [] } },
    powers: { connectors: b.mcp, skills: b.skills ?? "all", plugins: b.plugins ?? {}, hooks: b.hooks ?? [] },
    permissions: { mode: b.mode || "same as my Claude Code", allow: b.allowTools ?? [], ask: b.askTools ?? [], deny: b.denyTools ?? [], autoSaveNotes: !!b.autoSaveIssues },
    notify: { needsYou: b.notify?.needsYou !== false, finished: b.notify?.finished !== false, failed: b.notify?.failed !== false, mac: !!b.notify?.mac },
  };
  return HEADER + yaml.dump(doc, { lineWidth: 120, noRefs: true });
}

// The YAML back into a PATCH body (the same shape configYaml writes); cleanPatch checks it.
export function parseConfigYaml(text: string): { body: Record<string, unknown> } | { error: string } {
  let d: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- checked by cleanPatch
  try {
    d = (yaml.load(text) ?? {}) as Record<string, unknown>;
  } catch (e) {
    return { error: `Not valid YAML: ${(e as Error).message.split("\n")[0]}` };
  }
  if (typeof d !== "object" || Array.isArray(d)) return { error: "Expected keys like triggers, knowledge, powers." };
  const pw = d.powers ?? {};
  const pm = d.permissions ?? {};
  return {
    body: {
      ...(d.model !== undefined ? { model: d.model === "default" ? "" : d.model } : {}),
      ...(d.effort !== undefined ? { effort: d.effort === "default" ? "" : d.effort } : {}),
      triggers: d.triggers,
      knowledge: d.knowledge,
      ...(d.knowledge?.sessions ? { sessionAccess: d.knowledge.sessions } : {}),
      mcp: pw.connectors,
      skills: pw.skills,
      plugins: pw.plugins,
      hooks: pw.hooks,
      ...(pm.mode !== undefined ? { mode: pm.mode === "same as my Claude Code" ? "" : pm.mode } : {}),
      allowTools: pm.allow,
      askTools: pm.ask,
      ...(pm.deny !== undefined ? { denyTools: pm.deny } : {}),
      autoSaveIssues: pm.autoSaveNotes,
      notify: d.notify,
    },
  };
}

// Every setting a PATCH may change, checked. Unknown keys are dropped.
export function cleanPatch(body: Record<string, any>): { patch: Partial<Bot> } | { error: string } { // eslint-disable-line @typescript-eslint/no-explicit-any -- untrusted input, checked here
  const patch: Partial<Bot> = cleanConfig(body);
  for (const k of ["name", "avatar", "about", "role", "style"] as const) if (typeof body[k] === "string") patch[k] = body[k].slice(0, k === "role" || k === "style" ? 20_000 : 200);
  if (body.mode !== undefined) {
    if (body.mode !== "" && !isPermissionMode(body.mode)) return { error: `"${body.mode}" isn't a permission mode.` };
    patch.mode = body.mode;
  }
  if (body.model !== undefined) {
    if (body.model !== "" && !isModel(body.model)) return { error: `"${body.model}" isn't a model Vlens knows.` };
    patch.model = body.model;
  }
  if (Array.isArray(body.mcp)) patch.mcp = body.mcp.filter((n: unknown) => typeof n === "string").slice(0, 100);
  if (body.sources) patch.sources = { sessionFolders: (body.sources.sessionFolders ?? []).filter((f: unknown) => typeof f === "string" && f.startsWith("/")) };
  if (body.sessionAccess && typeof body.sessionAccess === "object")
    patch.sessionAccess = { all: !!body.sessionAccess.all, folders: strs(body.sessionAccess.folders, 200).filter((f) => f.startsWith("/")) };
  if (typeof body.automation === "boolean") patch.automation = body.automation;
  if (body.rules) {
    const clean = (xs: unknown) => (Array.isArray(xs) ? xs.map((x) => String(x).replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 50).map((x) => x.slice(0, 300)) : []);
    patch.rules = { allowed: clean(body.rules.allowed), lookAt: clean(body.rules.lookAt), dontLookAt: clean(body.rules.dontLookAt) };
  }
  return { patch };
}
