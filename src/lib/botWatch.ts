import "server-only";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureIssue, getIssue, isIssueKey } from "./botIssues";
import { alertBot } from "./botNotifications";
import { runIssue, threadState } from "./botThreads";
import { BOTS_DIR, botDir, getBot, listBots, triggersOf } from "./bots";
import { findSessionFile, listSessions } from "./sessions";
import type { Bot, BotTrigger, SessionSummary } from "./types";

// A bot working on its own: its triggers (its Settings, Triggers). Each one finds
// things to work on with no AI, and only something new or changed costs tokens:
//
//   schedule  every few minutes, run its list command; it prints items as JSON
//   session   one of your Claude sessions, in the folders you picked, started,
//             ended or went idle (and mentions what `match` looks for)
//
// A new item opens a card and starts its thread with the brief; one whose version
// changed gets the update brief. Before that, the gate (a command, optional) can
// skip it (exit 10), put it off to the next check (exit 75), or add context (its output).

interface Item {
  key: string;
  title: string;
  url: string;
  version: string;
  kind: string;
  session: string;
  folder: string;
}
export interface TriggerState {
  lastRun?: string;
  lastResult?: string;
  lastError?: string;
  lastOk?: string; // the last check that worked
  failSince?: string; // when it started failing (cleared when a check works)
  failures?: number; // failed checks in a row
  seen: Record<string, string>; // key -> the version it last worked on
  sessions?: Record<string, { active: boolean; updatedAt: string; fired?: string }>; // session triggers
}
type State = { triggers: Record<string, TriggerState> };

// Its health, for the bot's page: how long it has been failing, and when it last worked.
function failed(s: TriggerState, error: string) {
  s.lastError = error;
  s.failures = (s.failures ?? 0) + 1;
  s.failSince ??= s.lastRun ?? new Date().toISOString();
}
function worked(s: TriggerState) {
  delete s.lastError;
  delete s.failSince;
  s.failures = 0;
  s.lastOk = s.lastRun ?? new Date().toISOString();
}


const statePath = (id: string) => path.join(botDir(id), "watch-state.json");
async function readState(id: string): Promise<State> {
  const raw = JSON.parse(await fs.readFile(statePath(id), "utf8").catch(() => "{}"));
  if (raw.triggers) return raw as State;
  // Before triggers, one watch kept its state at the top.
  return { triggers: raw.seen ? { watch: raw as TriggerState } : {} };
}
// Saves one trigger's state: its others may be checking at the same time.
const saves = new Map<string, Promise<void>>();
function saveTrigger(id: string, triggerId: string, s: TriggerState) {
  const next = (saves.get(id) ?? Promise.resolve()).then(async () => {
    const all = await readState(id);
    all.triggers[triggerId] = s;
    await fs.writeFile(statePath(id), JSON.stringify(all, null, 2));
  });
  saves.set(id, next.catch(() => {}));
  return next;
}
// One trigger's last check, for its card in Settings.
export async function readWatchState(id: string) {
  return (await readState(id)).triggers;
}

const running = new Set<string>(); // "bot:trigger"
const empty = (): TriggerState => ({ seen: {} });

function parse(out: string): Item[] {
  const t = out.trim();
  let raw: unknown[] = [];
  try {
    const j = JSON.parse(t);
    raw = Array.isArray(j) ? j : [j];
  } catch {
    raw = t.split("\n").flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
  }
  const seen = new Set<string>();
  return raw.flatMap((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    const key = String(o.key ?? "");
    if (!isIssueKey(key) || seen.has(key)) return [];
    seen.add(key);
    return [{ key, title: String(o.title ?? key).slice(0, 200), url: String(o.url ?? ""), version: String(o.version ?? ""), kind: String(o.kind ?? ""), session: "", folder: "" }];
  });
}

const fill = (t: string, i: Item) => t.replace(/\{(key|title|url|version|kind|session|folder)\}/g, (_, k: keyof Item) => i[k]);

// A trigger's list command run once, as a test: how many items it finds, a few titles.
export async function tryList(command: string, cwd: string): Promise<{ ok: true; found: number; sample: string[] } | { ok: false; error: string }> {
  const r = await sh(command, cwd, {}, 30_000);
  if (r.code !== 0) return { ok: false, error: r.err || `It stopped (exit ${r.code}).` };
  const items = parse(r.out);
  return { ok: true, found: items.length, sample: items.slice(0, 3).map((i) => i.title || i.key) };
}

function sh(command: string, cwd: string, env: Record<string, string> = {}, timeout = 120_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) =>
    execFile("/bin/sh", ["-c", command], { cwd, timeout, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as { code?: unknown }).code === "number" ? ((err as { code: number }).code) : 1) : 0;
      resolve({ code, out: stdout, err: (stderr || (err && code === 1 ? err.message : "") || "").trim().slice(0, 500) });
    }),
  );
}

// What the gate says about one item: go (with what it printed), skip, or later.
async function gate(t: BotTrigger, bot: Bot, it: Item): Promise<{ go: true; extra: string } | { go: false; later: boolean; error?: string }> {
  if (!t.gate.trim()) return { go: true, extra: "" };
  const r = await sh(t.gate, bot.dir, { VLENS_KEY: it.key, VLENS_TITLE: it.title, VLENS_URL: it.url, VLENS_VERSION: it.version, VLENS_KIND: it.kind, VLENS_SESSION: it.session, VLENS_FOLDER: it.folder }, 5 * 60_000);
  if (r.code === 0) return { go: true, extra: r.out.trim().slice(0, 8000) };
  if (r.code === 10) return { go: false, later: false };
  if (r.code === 75) return { go: false, later: true };
  return { go: false, later: true, error: `Gate failed on ${it.key} (exit ${r.code}): ${r.err || r.out.trim().slice(0, 300)}` };
}

// ── Finding items ───────────────────────────────────────────────────────────

const inside = (p: string, dir: string) => p === dir || p.startsWith(`${dir}/`);
const encode = (dir: string) => dir.replace(/[^A-Za-z0-9]/g, "-");

// The end of a session's file, as plain text, for `match`.
async function recentText(id: string) {
  const f = await findSessionFile(id);
  if (!f) return "";
  const h = await fs.open(f.file, "r").catch(() => null);
  if (!h) return "";
  try {
    const { size } = await h.stat();
    const len = Math.min(size, 200_000);
    const buf = Buffer.alloc(len);
    await h.read(buf, 0, len, size - len);
    return buf.toString("utf8");
  } finally {
    await h.close();
  }
}

async function sessionItems(t: BotTrigger, s: TriggerState): Promise<Item[]> {
  const folders = t.folders.map((f) => f.replace(/\/+$/, ""));
  const recent = Date.now() - 2 * 24 * 3600_000;
  const all = (await listSessions()).filter(
    (x: SessionSummary) => x.cwd && !x.botId && !inside(x.cwd, BOTS_DIR) && Date.parse(x.updatedAt) > recent && folders.some((f) => inside(x.cwd!, f) || x.projectDir === encode(f)),
  );
  const first = !s.sessions; // the first check only learns what's there
  const was = s.sessions ?? {};
  const now: NonNullable<TriggerState["sessions"]> = {};
  const fired: SessionSummary[] = [];
  for (const x of all) {
    const prev = was[x.id];
    const active = !!x.active;
    now[x.id] = { active, updatedAt: x.updatedAt, fired: prev?.fired };
    if (first) continue;
    const hit =
      t.event === "started" ? !prev && active
      : t.event === "ended" ? !!prev?.active && !active
      : active && x.active?.status === "idle" && Date.now() - Date.parse(x.updatedAt) >= t.idleMinutes * 60_000 && prev?.fired !== x.updatedAt;
    if (hit) {
      now[x.id].fired = x.updatedAt;
      fired.push(x);
    }
  }
  s.sessions = now;
  let re: RegExp | null = null;
  try {
    re = t.match.trim() ? new RegExp(t.match) : null;
  } catch {
    throw new Error(`"${t.match}" isn't a valid pattern.`);
  }
  const items: Item[] = [];
  for (const x of fired) {
    let key = `S-${x.id.slice(0, 8)}`;
    if (re) {
      const m = re.exec(x.title) ?? re.exec(await recentText(x.id));
      if (!m) continue;
      const k = m[1] ?? m[0];
      if (isIssueKey(k)) key = k;
    }
    if (!items.some((i) => i.key === key)) items.push({ key, title: x.title, url: "", version: x.updatedAt, kind: "session", session: x.id, folder: x.cwd ?? "" });
  }
  return items;
}

// ── One check ───────────────────────────────────────────────────────────────

export async function checkTrigger(id: string, triggerId: string): Promise<{ ok: boolean; summary: string }> {
  const bot = await getBot(id);
  const t = bot && triggersOf(bot).find((x) => x.id === triggerId);
  if (!bot || !t) return { ok: false, summary: "No such trigger." };
  if (t.kind === "schedule" && !t.list.trim()) return { ok: false, summary: "This trigger has no list command." };
  if (t.kind === "session" && !t.folders.length) return { ok: false, summary: "Pick the folders it watches." };
  const lock = `${id}:${t.id}`;
  if (running.has(lock)) return { ok: false, summary: "A check is already running." };
  running.add(lock);
  const state = (await readState(id)).triggers[t.id] ?? empty();
  const hadError = state.lastError;
  state.lastRun = new Date().toISOString();
  try {
    let items: Item[];
    if (t.kind === "schedule") {
      const r = await sh(t.list, bot.dir);
      if (r.code !== 0) throw new Error(r.err || `The list command stopped (exit ${r.code}).`);
      items = parse(r.out);
    } else items = await sessionItems(t, state);

    let opened = 0;
    let updated = 0;
    let later = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const it of items) {
      const prev = state.seen[it.key];
      const card = await getIssue(id, it.key);
      const isNew = prev === undefined && !card;
      const changed = t.kind === "session" ? true : !!it.version && prev !== undefined && prev !== it.version;
      if (!isNew && prev === undefined && t.kind === "schedule") {
        state.seen[it.key] = it.version; // a card you opened yourself: just start tracking it
        continue;
      }
      if (!isNew && !changed) continue;
      const brief = isNew ? t.brief : t.updateBrief.trim() || (t.kind === "session" ? t.brief : "");
      if (!brief.trim()) continue;
      if (isNew && opened >= t.maxNew) {
        later++;
        continue;
      }
      if (!isNew && threadState(id, it.key).running) {
        later++;
        continue;
      }
      const g = await gate(t, bot, it);
      if (!g.go) {
        if (g.error) errors.push(g.error);
        if (g.later) later++;
        else {
          skipped++;
          state.seen[it.key] = it.version; // skipped for this version
        }
        continue;
      }
      if (isNew) await ensureIssue(id, it.key, it.title);
      const prompt = fill(brief, it) + (g.extra ? `\n\n## Gate output\n\n${g.extra}` : "");
      if (runIssue(id, it.key, prompt, done(bot, it)).ok) {
        state.seen[it.key] = it.version;
        if (isNew) opened++;
        else updated++;
      }
    }
    state.lastResult = `Found ${items.length}. ${opened} new card${opened === 1 ? "" : "s"}, ${updated} updated${skipped ? `, ${skipped} skipped by the gate` : ""}${later ? `, ${later} for the next check` : ""}.`;
    if (errors.length) failed(state, errors[0]);
    else worked(state);
    return { ok: !errors.length, summary: errors[0] ?? state.lastResult };
  } catch (e) {
    failed(state, (e as Error).message);
    return { ok: false, summary: state.lastError! };
  } finally {
    // Say so once when it starts failing, not every check.
    if (state.lastError && state.lastError !== hadError) void alertBot(bot, "failed", { title: `${t.name} failed`, body: state.lastError });
    await saveTrigger(id, t.id, state).catch(() => {});
    running.delete(lock);
  }
}

// When a card a trigger started finishes: say so in the bell.
const done = (bot: Bot, it: Item) => async (r: { error: string | null }) => {
  const i = await getIssue(bot.id, it.key);
  await alertBot(bot, r.error ? "failed" : "finished", { title: r.error ? `${it.key}: stopped with an error` : `${it.key}: ${i?.status ?? "done"}`, body: r.error ?? it.title, target: { kind: "issue", key: it.key } });
};

// While Vlens runs: each trigger that's on, at its own pace (session triggers every minute).
export function startWatches() {
  const g = globalThis as { lensBotWatches?: ReturnType<typeof setInterval> };
  if (g.lensBotWatches) return;
  g.lensBotWatches = setInterval(async () => {
    for (const b of await listBots().catch(() => [] as Bot[])) {
      const ts = triggersOf(b).filter((t) => t.on);
      if (!ts.length || b.paused) continue; // paused from its page: triggers stay set up, nothing runs
      const st = await readState(b.id);
      for (const t of ts) {
        if (running.has(`${b.id}:${t.id}`)) continue;
        const last = st.triggers[t.id]?.lastRun;
        const every = t.kind === "session" ? 1 : t.everyMinutes;
        if (last && Date.now() - Date.parse(last) < every * 60_000 - 5_000) continue;
        void checkTrigger(b.id, t.id);
      }
    }
  }, 60_000);
}

// ── Test buttons (no AI, nothing opened) ────────────────────────────────────

// What the trigger would find right now. A session trigger: the sessions it watches, and the key each gives.
export async function testList(id: string, triggerId: string): Promise<{ ok: boolean; items: Item[]; error?: string }> {
  const bot = await getBot(id);
  const t = bot && triggersOf(bot).find((x) => x.id === triggerId);
  if (!bot || !t) return { ok: false, items: [], error: "No such trigger." };
  if (t.kind === "schedule") {
    if (!t.list.trim()) return { ok: false, items: [], error: "No list command yet." };
    const r = await sh(t.list, bot.dir);
    if (r.code !== 0) return { ok: false, items: [], error: r.err || `Exit ${r.code}` };
    const items = parse(r.out);
    return items.length || !r.out.trim() ? { ok: true, items } : { ok: false, items, error: `Printed something, but no items with a key: ${r.out.trim().slice(0, 200)}` };
  }
  try {
    const probe: BotTrigger = { ...t, event: "ended" };
    const s: TriggerState = { seen: {}, sessions: {} };
    // Pretend every session just ended, to see which match and the keys they'd give.
    const folders = t.folders.map((f) => f.replace(/\/+$/, ""));
    for (const x of await listSessions()) if (x.cwd && folders.some((f) => inside(x.cwd!, f) || x.projectDir === encode(f))) s.sessions![x.id] = { active: true, updatedAt: x.updatedAt };
    const items = (await sessionItems(probe, s)).slice(0, 30);
    return { ok: true, items };
  } catch (e) {
    return { ok: false, items: [], error: (e as Error).message };
  }
}

export async function testGate(id: string, triggerId: string, item: Partial<Item>): Promise<{ ok: boolean; result: string }> {
  const bot = await getBot(id);
  const t = bot && triggersOf(bot).find((x) => x.id === triggerId);
  if (!bot || !t) return { ok: false, result: "No such trigger." };
  if (!t.gate.trim()) return { ok: false, result: "No gate set: every item goes on." };
  const it: Item = { key: "", title: "", url: "", version: "", kind: "", session: "", folder: "", ...item };
  const g = await gate(t, bot, it);
  if (g.go) return { ok: true, result: g.extra ? `Goes on, adding:\n${g.extra}` : "Goes on (printed nothing to add)." };
  return { ok: !g.error, result: g.error ?? (g.later ? "Tries again next check (exit 75)." : "Skipped (exit 10).") };
}
