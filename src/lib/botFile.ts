import yaml from "js-yaml";
import { ABILITIES, type Level, LEVELS, levelLabel, levelOf, widens } from "./botAbilities";
import type { Bot, BotTrigger } from "./types";

// A bot, as one readable file (bot.md in its folder, OKF: Markdown with YAML
// frontmatter). It is the bot's setup in plain words, and Vlens builds the real
// setup from it (triggers, permission rules, connectors). It round-trips with
// bot.json: Vlens rewrites bot.md whenever the bot changes, and applying an edited
// bot.md changes the bot. Pure: used by the server and the page.
//
//   ---
//   type: bot
//   name: PR Reviewer
//   apps: [dev-agent-harness]
//   ---
//   ## When
//   - every 15 min: review requests
//     check: `gh search prs --review-requested=@me …`
//     brief: |
//       New PR {key}: {title}
//   - when a session ends in ~/Desktop/org_repos: session coach
//   ## Think            (where it looks: one sentence per line)
//   ## Act              (what it does)
//   ## May do           (- Comment or review on GitHub: ask me · - allow: `Bash(ls:*)`)
//   ## Knows            (- sessions: ~/Desktop/org_repos · - confluence: 123 Title · - skills: all)
//   ## Off limits       (one per line; paths are blocked for real)
//   ## Operations       (its playbook, free text)

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
}

export interface FileError {
  line: number | null;
  message: string;
}

export const BRAIN_LABEL = { off: "off", read: "read only", remember: "read and remember" } as const;

const SECTIONS = ["When", "Think", "Act", "May do", "Knows", "Off limits", "Operations"] as const;
const tilde = (p: string, home: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);
const untilde = (p: string, home: string) => (p.startsWith("~") ? home + p.slice(1) : p);
const unquote = (v: string) => v.trim().replace(/^`([\s\S]*)`$/, "$1");
const quote = (v: string) => (/[`]/.test(v) ? v : `\`${v}\``);

// ── Write (bot → file) ───────────────────────────────────────────────────────

function triggerLine(t: BotTrigger, home: string) {
  const where = t.folders.length ? `in ${t.folders.map((f) => tilde(f, home)).join(", ")}` : "in all folders";
  const head =
    t.kind === "schedule"
      ? `every ${t.everyMinutes} min`
      : t.event === "idle"
        ? `when a session goes idle for ${t.idleMinutes} min ${where}`
        : `when a session ${t.event === "started" ? "starts" : "ends"} ${where}`;
  const lines = [`- ${t.on ? "" : "(paused) "}${head}: ${t.name}`];
  const field = (k: string, v: string) => {
    if (!v.trim()) return;
    if (v.includes("\n")) lines.push(`  ${k}: |`, ...v.split("\n").map((l) => `    ${l}`));
    else lines.push(`  ${k}: ${k === "check" || k === "gate" ? quote(v) : v}`);
  };
  if (t.kind === "schedule") field("check", t.list);
  else field("match", t.match);
  field("gate", t.gate);
  field("brief", t.brief);
  field("update brief", t.updateBrief);
  if (t.maxNew !== 3) lines.push(`  max new: ${t.maxNew}`);
  return lines.join("\n");
}

export function writeBotFile(b: Bot, home: string): string {
  const fm = {
    type: "bot",
    name: b.name,
    avatar: b.avatar || undefined,
    about: b.about || undefined,
    apps: b.mcp,
    model: b.model || undefined,
    effort: b.effort || undefined,
    mode: b.mode || undefined,
  };
  const out: string[] = ["---", yaml.dump(fm, { lineWidth: 200, flowLevel: 1 }).trim(), "---", ""];
  const section = (title: string, body: string) => out.push(`## ${title}`, body.trim() || "", "");
  const bullets = (xs: string[]) => xs.map((x) => `- ${x}`).join("\n");

  const ts = b.triggers ?? [];
  section("When", ts.length ? ts.map((t) => triggerLine(t, home)).join("\n") : "- only when you message it");
  section("Think", bullets(b.rules.lookAt));
  section("Act", bullets(b.rules.allowed));
  // Every action from the catalog that applies, then any other rules as they are.
  const covered = new Set<string>();
  const may = ABILITIES.filter((a) => !a.when || a.when(b)).map((a) => {
    a.rules.forEach((r) => covered.add(r));
    return `- ${a.label}: ${levelLabel(levelOf(b, a)).toLowerCase()}`;
  });
  const raw = (k: string, xs: string[] | undefined) => (xs ?? []).filter((r) => !covered.has(r)).map((r) => `- ${k}: ${quote(r)}`);
  section("May do", [...may, ...raw("allow", b.allowTools), ...raw("ask", b.askTools), ...raw("never", b.denyTools)].join("\n"));
  const sess = b.sessionAccess;
  const knows = [
    `- brain: ${BRAIN_LABEL[b.brain ?? "off"]}`,
    ...((b.brain ?? "off") !== "off" ? [`- brain folders: ${b.brainFolders?.length ? b.brainFolders.map((f) => tilde(f, home)).join(", ") : "all"}`] : []),
    ...(b.brain === "remember" ? [`- brain learns from: ${!b.brainLearn ? "off" : b.brainLearn.all ? "all sessions" : b.brainLearn.folders.map((f) => tilde(f, home)).join(", ") || "off"}`] : []),
    `- sessions: ${sess?.all ? "all" : sess?.folders.length ? sess.folders.map((f) => tilde(f, home)).join(", ") : "off"}`,
    ...(b.knowledge?.confluence ?? []).map((c) => `- confluence: ${c.id} ${c.title}`.trim()),
    `- skills: ${Array.isArray(b.skills) ? b.skills.join(", ") || "none" : "all"}`,
  ];
  section("Knows", knows.join("\n"));
  section("Off limits", bullets(b.rules.dontLookAt));
  section("Operations", b.role);
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// ── Read (file → parts) ──────────────────────────────────────────────────────

export function readBotFile(text: string): { file: BotFile | null; errors: FileError[] } {
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
      const base = { on: !paused, gate: "", match: "", brief: "", updateBrief: "", maxNew: 3, check: "", everyMinutes: 15, event: "ended" as const, idleMinutes: 30, folders: [] as string[] | "all" };
      if (sched) {
        const every = Number(sched[1]);
        if (every < 5) errors.push({ line, message: "Checks can run every 5 minutes at most." });
        t = { ...base, kind: "schedule", name: sched[2].trim(), everyMinutes: Math.max(5, every) };
      } else if (sess) {
        const ev = sess[1].toLowerCase().startsWith("starts") ? "started" : sess[1].toLowerCase().startsWith("ends") ? "ended" : "idle";
        const where = sess[3].trim();
        t = { ...base, kind: "session", name: sess[4].trim(), event: ev, idleMinutes: Number(sess[2]) || 30, folders: /^all folders$/i.test(where) ? "all" : where.split(",").map((x) => x.trim()).filter(Boolean) };
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
    return {
      id,
      name: t.name,
      on: t.on,
      kind: t.kind,
      everyMinutes: t.everyMinutes,
      list: t.check,
      gate: t.gate,
      event: t.event,
      idleMinutes: t.idleMinutes,
      folders: t.folders === "all" ? [] : t.folders.map((x) => untilde(x, home)),
      match: t.match,
      brief: t.brief.trim(),
      updateBrief: t.updateBrief.trim(),
      maxNew: t.maxNew,
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
    if (!p) out.push({ text: `New trigger "${t.name}"${t.kind === "schedule" ? `, every ${t.everyMinutes} min` : ""}`, widens: true });
    else {
      if (p.list !== t.list || p.gate !== t.gate) out.push({ text: `"${t.name}" runs a different command`, widens: true });
      if (p.everyMinutes !== t.everyMinutes && t.kind === "schedule") out.push({ text: `"${t.name}": every ${p.everyMinutes} → ${t.everyMinutes} min` });
      if (p.on !== t.on) out.push({ text: `"${t.name}" ${t.on ? "turns on" : "is paused"}`, widens: t.on });
      if (p.brief !== t.brief || p.updateBrief !== t.updateBrief) out.push({ text: `"${t.name}": what it does with each item` });
      if (JSON.stringify(p.folders) !== JSON.stringify(t.folders) || p.event !== t.event || p.match !== t.match) out.push({ text: `"${t.name}": which sessions it watches` });
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
    ? f.when.map((t) => (t.kind === "schedule" ? `Every ${t.everyMinutes} min: ${t.name}.` : `When a session ${t.event === "idle" ? "goes quiet" : t.event}: ${t.name}.`)).join(" ")
    : "When you message it.";
  return { when, think: f.think.slice(0, 2).join(" ") || "What you tell it in chat.", act: f.act.slice(0, 2).join(" ") || "It drafts and asks before posting." };
}
