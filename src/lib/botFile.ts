import yaml from "js-yaml";
import { ABILITIES, type Level, LEVELS, levelLabel, levelOf, widens } from "./botAbilities";
import { commandFor, isNativeSource, isSessionSource, type Limits, paramErrors, QUIET_RE, sourceOf } from "./botTriggers";
import type { Bot, BotTrigger } from "./types";

// A bot's setup as two files in its folder, like a harness agent:
//
//   agent.yaml    its settings: model, connectors, what it may do, what it knows,
//                 off limits, quiet hours and limits, and its triggers (on:)
//   PLAYBOOK.md   what it does when woken, in plain words. Its own "## …" parts
//                 can be named by a trigger (playbook: Reviewing); the "Where it
//                 looks" and "What it does" lists are its rules.
//
// Vlens builds the real setup from them (triggers, permission rules, connectors)
// and rewrites them whenever the bot changes (they round-trip with bot.json).
// The older single file (bot.md) is still read, to move a bot over. Pure: used
// by the server and the page.

export interface FileTrigger {
  name: string;
  on: boolean;
  kind: "schedule" | "session";
  everyMinutes: number;
  event: "ended" | "started" | "idle";
  idleMinutes: number;
  folders: string[] | "all";
  check: string;
  gate: string;
  match: string;
  brief: string;
  updateBrief: string;
  maxNew: number;
  source: string; // lib/botTriggers.ts
  params: Record<string, string>;
  playbook: string; // a "## …" part of its playbook
}

export interface BotFiles {
  agent: string; // agent.yaml
  playbook: string; // PLAYBOOK.md
}

export interface BotFile {
  name: string;
  avatar: string;
  about: string;
  apps: string[];
  model: string;
  effort: string;
  mode: string;
  when: FileTrigger[];
  think: string[];
  act: string[];
  mayDo: { label: string; level: Level }[];
  raw: { allow: string[]; ask: string[]; never: string[] };
  sessions: string[] | "all" | null;
  brain: "off" | "read" | "remember";
  brainFolders: string[] | "all"; // which folders' memories it reads
  brainLearn: "off" | "all" | string[]; // which of your Claude sessions the brain learns from, for it
  confluence: { id: string; title: string }[];
  skills: string[] | "all";
  offLimits: string[];
  operations: string;
  limits: Limits;
}

export interface FileError {
  line: number | null;
  message: string;
  file?: "agent" | "playbook";
}

export const BRAIN_LABEL = { off: "off", read: "read only", remember: "read and remember" } as const;

const SECTIONS = ["When", "Think", "Act", "May do", "Knows", "Off limits", "Operations"] as const;
const tilde = (p: string, home: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);
const untilde = (p: string, home: string) => (p.startsWith("~") ? home + p.slice(1) : p);
const unquote = (v: string) => v.trim().replace(/^`([\s\S]*)`$/, "$1");

// ── Write (bot → files) ──────────────────────────────────────────────────────

const WHERE = "Where it looks";
const WHAT = "What it does";
const sourceIdOf = (t: BotTrigger) => t.source || (t.kind === "session" ? `session.${t.event}` : "command");
const block = (v: string) => (v.includes("\n") ? v.replace(/\s+$/, "") + "\n" : v);

function triggerYaml(t: BotTrigger, home: string): Record<string, unknown> {
  const src = sourceIdOf(t);
  const def = sourceOf(src);
  const o: Record<string, unknown> = { name: t.name, source: src };
  if (!t.on) o.paused = true;
  if (!isSessionSource(src) && src !== "time" && t.everyMinutes !== def?.every) o.every = t.everyMinutes;
  for (const [k, v] of Object.entries(t.params ?? {})) if (v.trim()) o[k] = v;
  if (src === "command") o.check = t.list;
  if (isSessionSource(src)) {
    o.folders = t.folders.length ? t.folders.map((f) => tilde(f, home)) : "all";
    if (src === "session.idle") o.idleMinutes = t.idleMinutes;
    if (t.match.trim()) o.match = t.match;
  }
  if (t.gate.trim()) o.gate = t.gate;
  if (t.playbook) o.playbook = t.playbook;
  if (t.brief.trim() && t.brief.trim() !== def?.brief) o.brief = block(t.brief);
  if (t.updateBrief.trim() && t.updateBrief.trim() !== def?.updateBrief) o.updateBrief = block(t.updateBrief);
  if (t.maxNew !== 3) o.maxNew = t.maxNew;
  return o;
}

const AGENT_HEAD = (name: string) => `# ${name}: its settings. What it does when woken is in PLAYBOOK.md.
# Edit and apply from its Configuration page: Vlens checks it and shows each change first.
`;

// js-yaml quotes on/off/yes/no (booleans in old YAML); Vlens reads YAML 1.2, where they're words.
const dump = (doc: Record<string, unknown>) => yaml.dump(doc, { lineWidth: -1, noRefs: true, quotingType: '"' }).replace(/^"on":/m, "on:").replace(/: "(off|on)"$/gm, ": $1");

// One change to agent.yaml (a trigger switched, added or removed; quiet hours set),
// for the Triggers tab. The result is reviewed like any other edit.
export function editAgent(agent: string, fn: (doc: { on?: Record<string, unknown>[]; limits?: Record<string, unknown> } & Record<string, unknown>) => void): string {
  const doc = ((yaml.load(agent) as Record<string, unknown>) ?? {}) as Parameters<typeof fn>[0];
  if (!Array.isArray(doc.on)) doc.on = [];
  fn(doc);
  if (doc.limits && !Object.keys(doc.limits).length) delete doc.limits;
  return AGENT_HEAD(String(doc.name ?? "")) + "\n" + dump(doc);
}

export function writeBotFiles(b: Bot, home: string): BotFiles {
  const covered = new Set<string>();
  const may: Record<string, string> = {};
  for (const a of ABILITIES.filter((x) => !x.when || x.when(b))) {
    a.rules.forEach((r) => covered.add(r));
    may[a.label] = levelLabel(levelOf(b, a)).toLowerCase();
  }
  const extra = (xs: string[] | undefined) => (xs ?? []).filter((r) => !covered.has(r));
  const rules = { allow: extra(b.allowTools), ask: extra(b.askTools), never: extra(b.denyTools) };
  const sess = b.sessionAccess;
  const brain = b.brain ?? "off";
  const knows: Record<string, unknown> = { brain: BRAIN_LABEL[brain] };
  if (brain !== "off") knows.brainFolders = b.brainFolders?.length ? b.brainFolders.map((f) => tilde(f, home)) : "all";
  if (brain === "remember") knows.brainLearns = !b.brainLearn ? "off" : b.brainLearn.all ? "all sessions" : b.brainLearn.folders.length ? b.brainLearn.folders.map((f) => tilde(f, home)) : "off";
  knows.sessions = sess?.all ? "all" : sess?.folders.length ? sess.folders.map((f) => tilde(f, home)) : "off";
  if (b.knowledge?.confluence?.length) knows.confluence = b.knowledge.confluence.map((c) => ({ id: c.id, title: c.title }));
  knows.skills = Array.isArray(b.skills) ? b.skills : "all";
  const limits = b.limits && Object.keys(b.limits).length ? b.limits : undefined;
  const doc: Record<string, unknown> = {
    name: b.name,
    ...(b.avatar ? { avatar: b.avatar } : {}),
    ...(b.about ? { about: b.about } : {}),
    ...(b.model ? { model: b.model } : {}),
    ...(b.effort ? { effort: b.effort } : {}),
    ...(b.mode ? { mode: b.mode } : {}),
    connectors: b.mcp,
    may,
    ...(rules.allow.length || rules.ask.length || rules.never.length ? { rules: Object.fromEntries(Object.entries(rules).filter(([, v]) => v.length)) } : {}),
    knows,
    ...(b.rules.dontLookAt.length ? { offLimits: b.rules.dontLookAt } : {}),
    ...(limits ? { limits } : {}),
    on: (b.triggers ?? []).map((t) => triggerYaml(t, home)),
  };
  const agent = AGENT_HEAD(b.name) + "\n" + dump(doc);
  const list = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");
  const playbook = [`# ${b.name}`, "", b.role.trim(), "", `## ${WHERE}`, list(b.rules.lookAt), "", `## ${WHAT}`, list(b.rules.allowed), ""].join("\n").replace(/\n{3,}/g, "\n\n");
  return { agent, playbook };
}

// The "## …" parts of a playbook a trigger can name.
export const playbookParts = (operations: string) => [...operations.matchAll(/^##\s+(.+?)\s*$/gm)].map((m) => m[1]);

// ── Read (files → parts) ─────────────────────────────────────────────────────

const lineOf = (text: string, needle: string) => {
  const i = text.split("\n").findIndex((l) => l.includes(needle));
  return i < 0 ? null : i + 1;
};

function readPlaybook(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (/^#\s/.test(lines[0] ?? "")) lines.shift();
  const keep: string[] = [];
  const lists: Record<string, string[]> = { [WHERE]: [], [WHAT]: [] };
  let cur: string | null = null;
  for (const l of lines) {
    const h = l.match(/^##\s+(.+?)\s*$/);
    if (h) cur = [WHERE, WHAT].find((x) => x.toLowerCase() === h[1].toLowerCase()) ?? null;
    if (cur) {
      const b = l.match(/^\s*[-*]\s+(.*)$/)?.[1]?.trim();
      if (b) lists[cur].push(b);
      continue;
    }
    keep.push(l);
  }
  return { operations: keep.join("\n").trim(), think: lists[WHERE], act: lists[WHAT] };
}

export function readBotFiles(f: BotFiles): { file: BotFile | null; errors: FileError[] } {
  const errors: FileError[] = [];
  const err = (message: string, needle?: string) => errors.push({ file: "agent", line: needle ? lineOf(f.agent, needle) : null, message });
  let doc: Record<string, unknown>;
  try {
    doc = (yaml.load(f.agent) as Record<string, unknown>) ?? {};
    if (typeof doc !== "object" || Array.isArray(doc)) throw new Error("it should be a list of settings, like name: …");
  } catch (e) {
    const m = (e as { mark?: { line: number } }).mark;
    return { file: null, errors: [{ file: "agent", line: m ? m.line + 1 : null, message: `agent.yaml isn't valid YAML: ${(e as Error).message.split("\n")[0]}` }] };
  }
  const KNOWN = ["name", "avatar", "about", "model", "effort", "mode", "connectors", "may", "rules", "knows", "offLimits", "limits", "on"];
  for (const k of Object.keys(doc)) if (!KNOWN.includes(k)) err(`"${k}" isn't a setting Vlens knows: use ${KNOWN.join(", ")}.`, `${k}:`);
  const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).map((x) => x.trim()).filter(Boolean) : typeof v === "string" && v.trim() ? v.split(",").map((x) => x.trim()).filter(Boolean) : []);
  const allOr = (v: unknown, none: string): string[] | "all" | null => {
    if (v == null || (typeof v === "string" && v.trim().toLowerCase() === none)) return null;
    if (typeof v === "string" && /^all( sessions)?$/i.test(v.trim())) return "all";
    return strList(v);
  };
  const name = str(doc.name).trim();
  if (!name) err("Give it a name (name: …).");

  const mayDo: BotFile["mayDo"] = [];
  const may = (doc.may ?? {}) as Record<string, unknown>;
  if (typeof may !== "object" || Array.isArray(may)) err('"may" should list actions, like "Comment or review on GitHub: ask me".', "may:");
  else
    for (const [k, v] of Object.entries(may)) {
      const a = ABILITIES.find((x) => x.label.toLowerCase() === k.toLowerCase() || x.id === k.toLowerCase());
      const level = LEVELS.find((x) => x.label.toLowerCase() === str(v).toLowerCase() || x.id === str(v).toLowerCase())?.id;
      if (!a) err(`"${k}" isn't an action Vlens knows. Use one from the list, or a rule under rules: allow / ask / never.`, k);
      else if (!level) err(`"${v}" for ${a.label}: use on its own, ask me or never.`, k);
      else mayDo.push({ label: a.label, level });
    }
  const r = (doc.rules ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(r)) if (!["allow", "ask", "never"].includes(k)) err(`rules: "${k}" should be allow, ask or never.`, `${k}:`);
  const raw = { allow: strList(r.allow), ask: strList(r.ask), never: strList(r.never) };

  const kn = (doc.knows ?? {}) as Record<string, unknown>;
  for (const k of Object.keys(kn)) if (!["brain", "brainFolders", "brainLearns", "sessions", "confluence", "skills"].includes(k)) err(`knows: "${k}" isn't something Vlens knows.`, `${k}:`);
  const bx = str(kn.brain).toLowerCase();
  const brain: BotFile["brain"] = /remember|write/.test(bx) ? "remember" : /read/.test(bx) ? "read" : "off";
  const brainFolders = allOr(kn.brainFolders, "none") ?? "all";
  const learn = allOr(kn.brainLearns, "off");
  const brainLearn: BotFile["brainLearn"] = learn === null || (Array.isArray(learn) && !learn.length) ? "off" : learn;
  if (brainLearn !== "off" && brain !== "remember") err('"brainLearns" needs "brain: read and remember": a bot that learns has to be allowed to change the brain.', "brainLearns");
  const sx = allOr(kn.sessions, "off");
  const sessions: BotFile["sessions"] = sx === null || (Array.isArray(sx) && !sx.length) ? null : sx;
  const confluence = Array.isArray(kn.confluence)
    ? kn.confluence.flatMap((c) => {
        const o = (c ?? {}) as Record<string, unknown>;
        const id = str(o.id ?? (typeof c === "string" || typeof c === "number" ? c : "")).trim();
        return /^\d+$/.test(id) ? [{ id, title: str(o.title) }] : (err(`knows: confluence needs page ids, like { id: 12345, title: Page }.`, "confluence"), []);
      })
    : [];
  const sk = kn.skills;
  const skills: BotFile["skills"] = sk == null || (typeof sk === "string" && /^all$/i.test(sk.trim())) ? "all" : typeof sk === "string" && /^none$/i.test(sk.trim()) ? [] : strList(sk);

  const lim = (doc.limits ?? {}) as Record<string, unknown>;
  const limits: Limits = {};
  if (lim.quietHours != null) {
    if (QUIET_RE.test(str(lim.quietHours))) limits.quietHours = str(lim.quietHours);
    else err(`limits: quietHours should be like 20:00-08:00.`, "quietHours");
  }
  if (lim.weekdaysOnly != null) limits.weekdaysOnly = lim.weekdaysOnly === true;
  if (lim.maxRunsPerDay != null) {
    if (Number(lim.maxRunsPerDay) > 0) limits.maxRunsPerDay = Math.round(Number(lim.maxRunsPerDay));
    else err("limits: maxRunsPerDay should be a number above 0.", "maxRunsPerDay");
  }

  const pb = readPlaybook(f.playbook);
  const parts = playbookParts(pb.operations);
  const when: FileTrigger[] = [];
  const on = doc.on ?? [];
  if (!Array.isArray(on)) err('"on" should be a list of triggers, each starting with "- name: …".', "on:");
  else
    on.forEach((x, i) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const tname = str(o.name).trim() || `trigger ${i + 1}`;
      const src = str(o.source || "command").trim();
      const def = sourceOf(src);
      const p: Record<string, string> = {};
      for (const sp of def?.params ?? []) if (o[sp.key] != null) p[sp.key] = Array.isArray(o[sp.key]) ? (o[sp.key] as unknown[]).map(str).join(", ") : str(o[sp.key]);
      const known = ["name", "source", "paused", "every", "check", "gate", "folders", "idleMinutes", "match", "playbook", "brief", "updateBrief", "maxNew", ...(def?.params ?? []).map((q) => q.key)];
      for (const k of Object.keys(o)) if (!known.includes(k)) err(`"${tname}": "${k}" isn't a trigger setting for ${src}.`, `${k}:`);
      for (const m of paramErrors(src, p)) err(`"${tname}": ${m}`, `name: ${tname}`);
      const every = o.every == null ? (def?.every ?? 15) : Number(o.every);
      if (!isSessionSource(src) && src !== "time" && (!Number.isFinite(every) || every < 5)) err(`"${tname}": checks can run every 5 minutes at most.`, `name: ${tname}`);
      const playbook = str(o.playbook).trim();
      if (playbook && !parts.some((x) => x.toLowerCase() === playbook.toLowerCase())) errors.push({ file: "playbook", line: null, message: `"${tname}" follows the playbook part "${playbook}", but PLAYBOOK.md has no "## ${playbook}".` });
      const check = str(o.check);
      if (src === "command" && !check.trim()) err(`"${tname}" needs a check: the command that lists what to work on.`, `name: ${tname}`);
      const fx = isSessionSource(src) ? allOr(o.folders, "none") : [];
      when.push({
        name: tname,
        on: o.paused !== true,
        kind: isSessionSource(src) ? "session" : "schedule",
        everyMinutes: isSessionSource(src) ? 15 : Math.max(5, Number.isFinite(every) ? every : 15),
        event: src === "session.started" ? "started" : src === "session.idle" ? "idle" : "ended",
        idleMinutes: Number(o.idleMinutes) || 30,
        folders: fx === null ? [] : fx,
        check,
        gate: str(o.gate),
        match: str(o.match),
        brief: str(o.brief).replace(/\s+$/, ""),
        updateBrief: str(o.updateBrief).replace(/\s+$/, ""),
        maxNew: Math.max(1, Math.min(20, Number(o.maxNew) || 3)),
        source: src,
        params: p,
        playbook: parts.find((x) => x.toLowerCase() === playbook.toLowerCase()) ?? "",
      });
    });

  const file: BotFile = {
    name,
    avatar: str(doc.avatar).slice(0, 2),
    about: str(doc.about),
    apps: strList(doc.connectors),
    model: str(doc.model),
    effort: str(doc.effort),
    mode: str(doc.mode),
    when,
    think: pb.think,
    act: pb.act,
    mayDo,
    raw,
    sessions,
    brain,
    brainFolders,
    brainLearn,
    confluence,
    skills,
    offLimits: strList(doc.offLimits),
    operations: pb.operations,
    limits,
  };
  return { file, errors };
}

// ── Read (file → parts) ──────────────────────────────────────────────────────

// The older single file (bot.md): read only, to move a bot over.
export function readLegacyBotFile(text: string): { file: BotFile | null; errors: FileError[] } {
  const errors: FileError[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let fm: Record<string, unknown> = {};
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, n) => n > 0 && l.trim() === "---");
    if (end < 0) return { file: null, errors: [{ line: 1, message: "The frontmatter (between --- lines) isn't closed." }] };
    try {
      fm = (yaml.load(lines.slice(1, end).join("\n")) as Record<string, unknown>) ?? {};
    } catch (e) {
      return { file: null, errors: [{ line: 2, message: `The frontmatter isn't valid YAML: ${(e as Error).message.split("\n")[0]}` }] };
    }
    i = end + 1;
  }
  const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  const name = str(fm.name).trim();
  if (!name) errors.push({ line: 2, message: "Give it a name (name: … in the frontmatter)." });
  const apps = Array.isArray(fm.apps) ? fm.apps.map(str).filter(Boolean) : typeof fm.apps === "string" ? fm.apps.split(",").map((x) => x.trim()).filter(Boolean) : [];

  // Sections: "## Title" up to the next one.
  const body: Record<string, { start: number; lines: string[] }> = {};
  let cur: string | null = null;
  for (; i < lines.length; i++) {
    const h = lines[i].match(/^##\s+(.+?)\s*$/);
    if (h) {
      const t = SECTIONS.find((s) => s.toLowerCase() === h[1].toLowerCase());
      if (!t) errors.push({ line: i + 1, message: `"${h[1]}" isn't a section Vlens knows: use ${SECTIONS.join(", ")}.` });
      cur = t ?? null;
      if (cur) body[cur] = { start: i + 2, lines: [] };
      continue;
    }
    if (cur) body[cur].lines.push(lines[i]);
  }
  const bulletsOf = (s: string) => (body[s]?.lines ?? []).map((l) => l.match(/^\s*[-*]\s+(.*)$/)?.[1]?.trim()).filter((x): x is string => !!x);

  const when = readWhen(body.When, errors);

  const mayDo: BotFile["mayDo"] = [];
  const raw: BotFile["raw"] = { allow: [], ask: [], never: [] };
  (body["May do"]?.lines ?? []).forEach((l, n) => {
    const m = l.match(/^\s*[-*]\s+(.+?):\s*(.+?)\s*$/);
    if (!m) return;
    const [, k, v] = m;
    const key = k.trim().toLowerCase();
    if (key === "allow" || key === "ask" || key === "never") return void raw[key].push(unquote(v));
    const level = LEVELS.find((x) => x.label.toLowerCase() === v.toLowerCase() || x.id === v.toLowerCase())?.id;
    const a = ABILITIES.find((x) => x.label.toLowerCase() === key || x.id === key);
    const line = (body["May do"]?.start ?? 0) + n;
    if (!a) errors.push({ line, message: `"${k}" isn't an action Vlens knows. Use one from the list, or a rule like "- ask: \`Bash(gh pr comment:*)\`".` });
    else if (!level) errors.push({ line, message: `"${v}" for ${a.label}: use on its own, ask me or never.` });
    else mayDo.push({ label: a.label, level });
  });

  let sessions: BotFile["sessions"] = null;
  let brain: BotFile["brain"] = "off";
  let brainFolders: BotFile["brainFolders"] = "all";
  let brainLearn: BotFile["brainLearn"] = "off";
  const confluence: BotFile["confluence"] = [];
  let skills: BotFile["skills"] = "all";
  for (const b of bulletsOf("Knows")) {
    const m = b.match(/^(sessions|confluence|skills|brain learns from|brain folders|brain):\s*(.*)$/i);
    if (!m) continue;
    const [, k, v] = m;
    if (k.toLowerCase() === "brain learns from") {
      const x = v.trim();
      brainLearn = /^off$/i.test(x) || !x ? "off" : /^all( sessions)?$/i.test(x) ? "all" : x.split(",").map((y) => y.trim()).filter(Boolean);
    } else if (k.toLowerCase() === "brain folders") brainFolders = /^all$/i.test(v.trim()) ? "all" : v.split(",").map((x) => x.trim()).filter(Boolean);
    else if (k.toLowerCase() === "brain") {
      const x = v.trim().toLowerCase();
      brain = /remember|write/.test(x) ? "remember" : /read/.test(x) ? "read" : "off";
    } else if (k.toLowerCase() === "sessions") sessions = /^off$/i.test(v.trim()) ? null : /^all$/i.test(v.trim()) ? "all" : v.split(",").map((x) => x.trim()).filter(Boolean);
    else if (k.toLowerCase() === "confluence") {
      const c = v.trim().match(/^(\d+)\s*(.*)$/);
      if (c) confluence.push({ id: c[1], title: c[2] });
    } else skills = /^all$/i.test(v.trim()) ? "all" : /^none$/i.test(v.trim()) ? [] : v.split(",").map((x) => x.trim()).filter(Boolean);
  }

  if (brainLearn !== "off" && brain !== "remember") errors.push({ line: null, message: '"brain learns from" needs "brain: read and remember": a bot that learns has to be allowed to change the brain.' });
  const operations = (body.Operations?.lines ?? []).join("\n").trim();
  const file: BotFile = {
    name,
    avatar: str(fm.avatar).slice(0, 2),
    about: str(fm.about),
    apps,
    model: str(fm.model),
    effort: str(fm.effort),
    mode: str(fm.mode),
    when,
    think: bulletsOf("Think"),
    act: bulletsOf("Act"),
    mayDo,
    raw,
    sessions,
    brain,
    brainFolders,
    brainLearn,
    confluence,
    skills,
    offLimits: bulletsOf("Off limits"),
    operations,
    limits: {},
  };
  return { file, errors };
}

function readWhen(sec: { start: number; lines: string[] } | undefined, errors: FileError[]): FileTrigger[] {
  const out: FileTrigger[] = [];
  if (!sec) return out;
  let t: FileTrigger | null = null;
  let multi: { key: string; lines: string[] } | null = null;
  const flush = () => {
    if (t && multi) set(t, multi.key, multi.lines.join("\n"));
    multi = null;
  };
  const set = (tr: FileTrigger, key: string, v: string) => {
    if (key === "check") tr.check = unquote(v);
    else if (key === "gate") tr.gate = unquote(v);
    else if (key === "match") tr.match = v.trim();
    else if (key === "brief") tr.brief = v;
    else if (key === "update brief") tr.updateBrief = v;
    else if (key === "max new") tr.maxNew = Math.max(1, Math.min(20, Number(v) || 3));
  };
  sec.lines.forEach((l, n) => {
    const line = sec.start + n;
    if (multi && (/^\s{4,}/.test(l) || !l.trim())) {
      multi.lines.push(l.replace(/^\s{4}/, ""));
      return;
    }
    flush();
    const top = l.match(/^[-*]\s+(.*)$/);
    if (top) {
      const s = top[1].trim();
      if (/^only when you message it$/i.test(s)) return;
      const paused = /^\(paused\)\s*/i.test(s);
      const rest = s.replace(/^\(paused\)\s*/i, "");
      const sched = rest.match(/^every\s+(\d+)\s*(?:min|minutes?)\s*:\s*(.+)$/i);
      const sess = rest.match(/^when a session (starts|ends|goes idle(?: for (\d+) min)?)\s+in\s+(.+?)\s*:\s*(.+)$/i);
      const base = { on: !paused, gate: "", match: "", brief: "", updateBrief: "", maxNew: 3, check: "", everyMinutes: 15, event: "ended" as const, idleMinutes: 30, folders: [] as string[] | "all", source: "command", params: {}, playbook: "" };
      if (sched) {
        const every = Number(sched[1]);
        if (every < 5) errors.push({ line, message: "Checks can run every 5 minutes at most." });
        t = { ...base, kind: "schedule", name: sched[2].trim(), everyMinutes: Math.max(5, every) };
      } else if (sess) {
        const ev = sess[1].toLowerCase().startsWith("starts") ? "started" : sess[1].toLowerCase().startsWith("ends") ? "ended" : "idle";
        const where = sess[3].trim();
        t = { ...base, kind: "session", source: `session.${ev}`, name: sess[4].trim(), event: ev, idleMinutes: Number(sess[2]) || 30, folders: /^all folders$/i.test(where) ? "all" : where.split(",").map((x) => x.trim()).filter(Boolean) };
      } else {
        errors.push({ line, message: `Can't read "${s}". Write "every 15 min: name" or "when a session ends in ~/folder: name".` });
        t = null;
        return;
      }
      out.push(t);
      return;
    }
    const sub = l.match(/^\s+([a-z ]+?):\s*(.*)$/i);
    if (sub && t) {
      const key = sub[1].trim().toLowerCase();
      if (sub[2].trim() === "|") multi = { key, lines: [] };
      else set(t, key, sub[2]);
    }
  });
  flush();
  for (const x of out) {
    if (x.kind === "schedule" && !x.check.trim()) errors.push({ line: null, message: `"${x.name}" needs a check: the command that lists what to work on.` });
    if (!x.brief.trim()) errors.push({ line: null, message: `"${x.name}" needs a brief: what to do with each item.` });
  }
  return out;
}

// ── Build (file → the bot's setup) ───────────────────────────────────────────

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "trigger";

// The settings this file means for bot `b` (keeps trigger ids, so what they've seen stays).
export function buildFromFile(f: BotFile, b: Pick<Bot, "triggers" | "mcp">, home: string): Partial<Bot> {
  const prev = b.triggers ?? [];
  const taken = new Set<string>();
  const triggers: BotTrigger[] = f.when.map((t) => {
    const same = prev.find((p) => p.name === t.name && !taken.has(p.id));
    let id = same?.id ?? slug(t.name);
    while (taken.has(id)) id += "-2";
    taken.add(id);
    const def = sourceOf(t.source);
    const preset = t.source !== "command" && !isSessionSource(t.source);
    return {
      id,
      name: t.name,
      on: t.on,
      kind: t.kind,
      everyMinutes: t.everyMinutes,
      list: t.source === "command" ? t.check : preset && !isNativeSource(t.source) ? commandFor(t.source, t.params) : "",
      gate: t.gate,
      event: t.event,
      idleMinutes: t.idleMinutes,
      folders: t.folders === "all" ? [] : t.folders.map((x) => untilde(x, home)),
      match: t.match,
      brief: t.brief.trim() || def?.brief || "",
      updateBrief: t.updateBrief.trim() || def?.updateBrief || "",
      maxNew: t.maxNew,
      ...(t.source && t.source !== "command" ? { source: t.source } : {}),
      ...(Object.keys(t.params).length ? { params: t.params } : {}),
      ...(t.playbook ? { playbook: t.playbook } : {}),
    };
  });
  const allow = [...f.raw.allow];
  const ask = [...f.raw.ask];
  const deny = [...f.raw.never];
  for (const m of f.mayDo) {
    const a = ABILITIES.find((x) => x.label === m.label)!;
    (m.level === "on" ? allow : m.level === "ask" ? ask : deny).push(...a.rules);
  }
  const uniq = (xs: string[]) => [...new Set(xs)];
  return {
    name: f.name,
    avatar: f.avatar,
    about: f.about,
    mcp: f.apps,
    model: f.model,
    effort: f.effort as Bot["effort"],
    mode: f.mode,
    triggers,
    rules: { allowed: f.act, lookAt: f.think, dontLookAt: f.offLimits },
    role: f.operations,
    allowTools: uniq(allow),
    askTools: uniq(ask),
    denyTools: uniq(deny),
    sessionAccess: f.sessions === "all" ? { all: true, folders: [] } : { all: false, folders: (f.sessions ?? []).map((x) => untilde(x, home)) },
    knowledge: { confluence: f.confluence },
    brain: f.brain,
    brainFolders: f.brainFolders === "all" ? [] : f.brainFolders.map((x) => untilde(x, home)),
    brainLearn: f.brain !== "remember" || f.brainLearn === "off" ? undefined : f.brainLearn === "all" ? { all: true, folders: [] } : { all: false, folders: f.brainLearn.map((x) => untilde(x, home)) },
    skills: f.skills === "all" ? null : f.skills,
    limits: (Object.keys(f.limits).length ? f.limits : null) as Bot["limits"], // null clears them
  };
}

// ── What changes, in plain words ─────────────────────────────────────────────

export interface Change {
  text: string;
  widens?: boolean; // gives it more access: you approve it knowingly
}

export function changesBetween(b: Bot, next: Partial<Bot>): Change[] {
  const out: Change[] = [];
  const after = { ...b, ...next } as Bot;
  if (b.name !== after.name) out.push({ text: `Name: ${b.name} → ${after.name}` });
  if (b.about !== after.about) out.push({ text: "Its description" });
  const appName = (n: string) => n.replace(/^claude\.ai /, "");
  for (const a of after.mcp.filter((x) => !b.mcp.includes(x))) out.push({ text: `Starts using ${appName(a)}`, widens: true });
  for (const a of b.mcp.filter((x) => !after.mcp.includes(x))) out.push({ text: `Stops using ${appName(a)}` });
  const was = new Map((b.triggers ?? []).map((t) => [t.id, t]));
  for (const t of after.triggers ?? []) {
    const p = was.get(t.id);
    if (!p) {
      const src = sourceOf(t.source);
      const how = t.source === "time" ? `, at ${t.params?.at ?? "09:00"}` : t.source && t.source !== "command" ? `: ${src?.label.toLowerCase() ?? t.source}` : t.kind === "schedule" ? `, every ${t.everyMinutes} min` : "";
      out.push({ text: `New trigger "${t.name}"${how}`, widens: true });
    }
    else {
      if (p.list !== t.list || p.gate !== t.gate) out.push({ text: `"${t.name}" runs a different command`, widens: true });
      if (p.everyMinutes !== t.everyMinutes && t.kind === "schedule") out.push({ text: `"${t.name}": every ${p.everyMinutes} → ${t.everyMinutes} min` });
      if (p.on !== t.on) out.push({ text: `"${t.name}" ${t.on ? "turns on" : "is paused"}`, widens: t.on });
      if (p.brief !== t.brief || p.updateBrief !== t.updateBrief) out.push({ text: `"${t.name}": what it does with each item` });
      if (JSON.stringify(p.folders) !== JSON.stringify(t.folders) || p.event !== t.event || p.match !== t.match) out.push({ text: `"${t.name}": which sessions it watches` });
      if ((p.source ?? "") !== (t.source ?? "") && !(p.list !== t.list)) out.push({ text: `"${t.name}" watches something else: ${sourceOf(t.source)?.label ?? t.source}`, widens: true });
      if (JSON.stringify(p.params ?? {}) !== JSON.stringify(t.params ?? {})) out.push({ text: `"${t.name}": its settings (${Object.entries(t.params ?? {}).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"})` });
      if ((p.playbook ?? "") !== (t.playbook ?? "")) out.push({ text: `"${t.name}" follows ${t.playbook ? `the "${t.playbook}" part of its playbook` : "its whole playbook"}` });
    }
    was.delete(t.id);
  }
  for (const t of was.values()) out.push({ text: `Removes trigger "${t.name}"` });
  for (const a of ABILITIES) {
    const from = levelOf(b, a);
    const to = levelOf(after, a);
    if (from !== to) out.push({ text: `${a.label}: ${levelLabel(from)} → ${levelLabel(to)}`, widens: widens(from, to) });
  }
  const covered = new Set(ABILITIES.flatMap((a) => a.rules));
  const added = (k: "allowTools" | "askTools" | "denyTools") => (after[k] ?? []).filter((r) => !covered.has(r) && !(b[k] ?? []).includes(r));
  for (const r of added("allowTools")) out.push({ text: `Runs without asking: ${r}`, widens: true });
  for (const r of added("askTools")) out.push({ text: `Asks first: ${r}` });
  for (const r of added("denyTools")) out.push({ text: `Never: ${r}` });
  const removed = (k: "allowTools" | "askTools" | "denyTools") => (b[k] ?? []).filter((r) => !covered.has(r) && !(after[k] ?? []).includes(r));
  for (const r of removed("askTools")) out.push({ text: `No longer asks first: ${r}`, widens: true });
  for (const r of removed("denyTools")) out.push({ text: `No longer blocked: ${r}`, widens: true });
  for (const r of removed("allowTools")) out.push({ text: `Asks again: ${r}` });
  const sess = (x: Bot) => (x.sessionAccess?.all ? ["all"] : (x.sessionAccess?.folders ?? []));
  if (JSON.stringify(sess(b)) !== JSON.stringify(sess(after))) out.push({ text: `Your Claude sessions: ${sess(after).join(", ") || "off"}`, widens: sess(after).some((f) => !sess(b).includes(f)) });
  const rank = { off: 0, read: 1, remember: 2 } as const;
  const bw = b.brain ?? "off";
  const ba = after.brain ?? "off";
  if (bw !== ba) out.push({ text: `Vlens brain: ${BRAIN_LABEL[bw]} → ${BRAIN_LABEL[ba]}`, widens: rank[ba] > rank[bw] });
  const fw = b.brainFolders ?? [];
  const fa = after.brainFolders ?? [];
  const lw = b.brainLearn;
  const la = after.brainLearn;
  const learnLabel = (l: Bot["brainLearn"]) => (!l ? "off" : l.all ? "all your sessions" : l.folders.map((x) => x.split("/").pop()).join(", ") || "off");
  if (learnLabel(lw) !== learnLabel(la)) {
    // Reading more of your sessions: all, or a folder it didn't learn from before.
    const more = !!la && (la.all ? !lw?.all : la.folders.some((x) => !lw?.all && !lw?.folders.includes(x)));
    out.push({ text: `The brain learns from: ${learnLabel(lw)} → ${learnLabel(la)}`, widens: more });
  }
  if (ba !== "off" && JSON.stringify(fw) !== JSON.stringify(fa)) {
    const short = (xs: string[]) => (xs.length ? xs.map((x) => x.split("/").pop()).join(", ") : "all folders");
    // Fewer limits = more it can read: from some folders to all, or a folder added.
    out.push({ text: `Brain memories from: ${short(fw)} → ${short(fa)}`, widens: (!fa.length && fw.length > 0) || fa.some((x) => fw.length > 0 && !fw.includes(x)) });
  }
  const lim = (x: Bot) => JSON.stringify(x.limits ?? {});
  if (lim(b) !== lim(after)) {
    const l = after.limits ?? {};
    const bits = [l.quietHours && `quiet ${l.quietHours}`, l.weekdaysOnly && "weekdays only", l.maxRunsPerDay && `at most ${l.maxRunsPerDay} runs a day`].filter(Boolean);
    out.push({ text: `When it may run: ${bits.join(", ") || "any time, no daily limit"}`, widens: (b.limits?.maxRunsPerDay ?? Infinity) < (l.maxRunsPerDay ?? Infinity) || (!!b.limits?.quietHours && !l.quietHours) || (!!b.limits?.weekdaysOnly && !l.weekdaysOnly) });
  }
  if (JSON.stringify(b.knowledge?.confluence ?? []) !== JSON.stringify(after.knowledge?.confluence ?? [])) out.push({ text: "Its Confluence pages" });
  if (JSON.stringify(b.skills ?? null) !== JSON.stringify(after.skills ?? null)) out.push({ text: "Its skills" });
  if ((["allowed", "lookAt", "dontLookAt"] as const).some((k) => JSON.stringify(b.rules[k]) !== JSON.stringify(after.rules[k]))) out.push({ text: "What it looks at, does, or must not touch" });
  if (b.role.trim() !== after.role.trim()) out.push({ text: "Its operations (playbook)" });
  if (b.model !== after.model) out.push({ text: `Model: ${b.model || "default"} → ${after.model || "default"}` });
  if (b.mode !== after.mode) out.push({ text: `Permission mode: ${b.mode || "same as your Claude Code"} → ${after.mode || "same as your Claude Code"}`, widens: /bypass|auto|acceptEdits/.test(after.mode) });
  return out;
}

// Its job in plain words, from the file (shown until it writes its own with set_job).
export function jobFromFile(f: BotFile) {
  const when = f.when.length
    ? f.when
        .map((t) =>
          t.source === "time"
            ? `At ${t.params.at ?? "09:00"}${t.params.days ? ` on ${t.params.days}` : ""}: ${t.name}.`
            : t.kind === "schedule"
              ? `${t.source !== "command" ? `${sourceOf(t.source)?.label ?? t.name}` : `Every ${t.everyMinutes} min`}: ${t.name}.`
              : `When a session ${t.event === "idle" ? "goes quiet" : t.event}: ${t.name}.`,
        )
        .join(" ")
    : "When you message it.";
  return { when, think: f.think.slice(0, 2).join(" ") || "What you tell it in chat.", act: f.act.slice(0, 2).join(" ") || "It drafts and asks before posting." };
}
