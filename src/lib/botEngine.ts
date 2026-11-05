/* eslint-disable @typescript-eslint/no-explicit-any -- reads untyped gh and model JSON */
import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { botArgs, botToolAllow, commitBot, getBot, listBots } from "./bots";
import { readSpec, type Trigger } from "./botSpec";
import { notifyBot } from "./botNotifications";
import { runClaudeOnce } from "./runClaude";
import { getSession, listSessions } from "./sessions";
import type { Bot, InboxItem } from "./types";

// The trigger engine. While Vlens runs, every bot whose automation is on gets
// its triggers checked (bot.yaml, lib/botSpec.ts), each at its own pace:
//
//   watch    find events with the trigger's connector: the clock, your Claude
//            sessions (both free), or Jira (a short Haiku run with the
//            harness's read_jira, since only Claude can reach it)
//   filter   drop what the trigger's filters exclude, before any model runs
//   dedupe   skip what it already handled at this version (a PR's head
//            commit, a ticket's update time, a session's last change)
//   decide   run: auto runs the playbook now; run: ask notifies you and waits
//            for Run it or Skip
//   run      Claude follows the playbook; what comes out is kept for your OK

const MAX_RUNS_PER_CHECK = 3; // so a busy morning doesn't burn your plan

interface Event {
  trigger?: string; // set by checkBot
  key: string; // the thing: a PR, a day's slot, a session, a ticket
  version: string; // a new one means look again
  title: string;
  url?: string;
  context: string; // what the playbook is given about it
  auto: boolean; // run without asking
}

// ── State per bot: when each trigger last checked ──

const stateFile = (b: Bot) => path.join(b.dir, "state.json");
async function readState(b: Bot): Promise<{ lastPoll: Record<string, string> }> {
  return fs.readFile(stateFile(b), "utf8").then((t) => JSON.parse(t), () => ({ lastPoll: {} }));
}
async function writeState(b: Bot, s: { lastPoll: Record<string, string> }) {
  await fs.writeFile(stateFile(b), JSON.stringify(s, null, 2));
}

// ── Items it made or is asking about ──

const inboxDir = (b: Bot) => path.join(b.dir, "inbox-items");
const itemFile = (b: Bot, key: string) => {
  if (!/^[\w.@-]+$/.test(key)) throw new Error("Bad item key.");
  return path.join(inboxDir(b), `${key}.json`);
};
export async function listItems(b: Bot): Promise<InboxItem[]> {
  const files = await fs.readdir(inboxDir(b)).catch(() => [] as string[]);
  const all = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => fs.readFile(path.join(inboxDir(b), f), "utf8").then((t) => JSON.parse(t) as InboxItem, () => null)));
  return all.filter((x): x is InboxItem => !!x).sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
}
const getItem = (b: Bot, key: string) => fs.readFile(itemFile(b, key), "utf8").then((t) => JSON.parse(t) as InboxItem, () => null);
async function putItem(b: Bot, it: InboxItem) {
  await fs.mkdir(inboxDir(b), { recursive: true });
  await fs.writeFile(itemFile(b, it.key), JSON.stringify(it, null, 2));
}
const itemKey = (t: Trigger, key: string) => `${t.id}__${key.replace(/[^\w.@-]/g, "-")}`.slice(0, 180);

// ── Watching ──

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
function watchSchedule(t: Trigger): Event[] {
  const now = new Date();
  const [h, m] = (t.at ?? "09:00").split(":").map(Number);
  if (t.days?.length && !t.days.includes(DAYS[now.getDay()])) return [];
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return [];
  const day = now.toLocaleDateString("en-CA"); // YYYY-MM-DD, local
  return [{ key: day, version: day, title: `${t.title}, ${now.toLocaleDateString()}`, context: `Scheduled run for ${day} (${t.at}).`, auto: t.run === "auto" }];
}

async function watchSessions(t: Trigger, since: string | undefined): Promise<Event[]> {
  if (!since) return []; // the first check only marks the time: no backlog
  const folders = t.folders ?? [];
  const done = (await listSessions()).filter(
    (s) => !s.botId && !s.active && s.updatedAt > since && s.cwd && (!folders.length || folders.some((f) => s.cwd === f || s.cwd!.startsWith(f + "/"))),
  );
  return done.slice(0, 10).map((s) => ({
    key: s.id,
    version: s.updatedAt,
    title: `${s.projectName}: ${s.title}`,
    context: `A Claude session finished: "${s.title}" in ${s.cwd} (session ${s.id}, last change ${s.updatedAt}).`,
    auto: t.run === "auto",
  }));
}

async function watchJira(b: Bot, t: Trigger): Promise<Event[]> {
  if (!b.mcp.includes("dev-agent-harness")) throw new Error("Jira triggers read through the dev-agent-harness connector. Tick it under Tools.");
  const r = await runClaudeOnce({
    prompt: `Call the dev-agent-harness MCP tool read_jira with jql=${JSON.stringify(t.jql)} and limit 25. Reply with ONLY a JSON array, no prose: [{"key":"ABC-1","summary":"…","status":"…","updated":"…","url":"https://…"}]. An empty result is [].`,
    cwd: b.dir,
    timeoutMs: 3 * 60_000,
    args: ["--no-session-persistence", "--model", "haiku", "--permission-mode", "default", "--allowedTools", "mcp__dev-agent-harness__read_jira", "--disallowedTools", "Bash,Write,Edit"],
  });
  if (!r.ok) throw new Error(`The Jira check didn't finish: ${r.error}`);
  const json = r.text.slice(r.text.indexOf("["), r.text.lastIndexOf("]") + 1);
  const issues = (JSON.parse(json || "[]") as any[]).filter((i) => /^[A-Z][A-Z0-9]+-\d+$/.test(String(i.key)));
  return issues.map((i) => ({
    key: String(i.key),
    version: String(i.updated ?? ""),
    title: `${i.key}: ${i.summary ?? ""}`,
    url: i.url,
    context: `Jira ${i.key} (${i.status ?? "?"}): ${i.summary ?? ""}. Updated ${i.updated ?? "?"}. Read it with read_jira key=${i.key}.`,
    auto: t.run === "auto",
  }));
}

// ── Running a playbook ──

async function runPlaybook(b: Bot, t: Trigger, e: Event, item: InboxItem) {
  // "notify": just news, no model.
  if (t.output === "notify") {
    const done: InboxItem = { ...item, kind: "notify", status: "ready", output: e.context, updatedAt: new Date().toISOString() };
    await putItem(b, done);
    await notifyBot(b, { title: e.title, body: e.context.split("\n").find((l) => l.startsWith(">"))?.slice(2) ?? "", target: { kind: "item", key: item.key } });
    return done;
  }
  await putItem(b, { ...item, status: "running", updatedAt: new Date().toISOString() });
  const notes = t.output === "notes";
  const prompt = [
    `${t.title}: something happened that your bot.yaml trigger "${t.id}" watches.`,
    ``,
    e.context,
    ``,
    t.playbook ? `Follow your playbook knowledge/${t.playbook}.` : "Do what your instructions say for this.",
    notes
      ? `Write what's worth keeping into your knowledge (knowledge/, OKF: one concept per file, YAML frontmatter with type, title, sources, updated). Add to files that already cover a topic. Vlens updates the index in CLAUDE.md. End with 2-3 lines on what you wrote.`
      : `Write the result for Arun to read and approve: plain Markdown, short. Don't post or send anything yourself.`,
  ].join("\n");
  const r = await runClaudeOnce({
    prompt,
    cwd: b.dir,
    timeoutMs: 15 * 60_000,
    args: [
      "--no-session-persistence",
      "--permission-mode", notes ? "acceptEdits" : "default",
      "--allowedTools", [...(notes ? ["Read", "Write", "Edit", "Glob", "Grep"] : ["Read", "Glob", "Grep"]), ...botToolAllow(b)].join(","),
      ...(b.model ? ["--model", b.model] : []),
      ...(await botArgs(b)),
    ],
  });
  const done: InboxItem = { ...item, status: r.ok ? "ready" : "error", output: r.ok ? r.text.trim() : undefined, error: r.ok ? undefined : r.error, updatedAt: new Date().toISOString() };
  await putItem(b, done);
  if (r.ok && notes) await commitBot(b.id, `${t.title}: notes from ${e.key}`);
  await notifyBot(b, r.ok ? { title: `${t.title}: ready`, body: e.title, target: { kind: "item", key: item.key } } : { title: `${t.title} couldn't run`, body: r.error ?? "", target: { kind: "item", key: item.key } });
  return done;
}

async function act(b: Bot, t: Trigger, e: Event) {
  const key = itemKey(t, e.key);
  const base: InboxItem = { key, trigger: t.id, triggerTitle: t.title, kind: t.output === "notes" ? "notes" : t.output === "notify" ? "notify" : "draft", title: e.title, url: e.url, context: e.context, version: e.version, status: "asked", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  return runPlaybook(b, t, e, (await getItem(b, key)) ?? base);
}

// ── Checking ──

const g = globalThis as { lensBotBusy?: Set<string>; lensBotTimer?: ReturnType<typeof setInterval> };
const busy = (g.lensBotBusy ??= new Set());

// Checks a bot's triggers that are due (or all of them, with force; or just one, with only).
export async function checkBot(id: string, force = false, only?: string): Promise<{ ran: number; asked: number; errors: string[] }> {
  const b = await getBot(id);
  if (!b) throw new Error("Bot not found.");
  if (busy.has(id)) return { ran: 0, asked: 0, errors: [] };
  busy.add(id);
  const errors: string[] = [];
  let ran = 0;
  const asked: Event[] = [];
  try {
    const spec = await readSpec(b.dir);
    if (spec.error) throw new Error(`bot.yaml: ${spec.error}`);
    const state = await readState(b);
    for (const t of spec.triggers) {
      if (t.run === "off" || t.on === "manual" || (only && t.id !== only)) continue;
      const last = state.lastPoll[t.id];
      if (!force && last && Date.now() - Date.parse(last) < t.every * 60_000) continue;
      state.lastPoll[t.id] = new Date().toISOString();
      await writeState(b, state);
      let events: Event[] = [];
      try {
        events =
          t.on === "schedule" ? watchSchedule(t)
          : t.on === "session.finished" ? await watchSessions(t, last)
          : t.on === "jira.issue" ? await watchJira(b, t)
          : [];
      } catch (e) {
        errors.push(`${t.title}: ${(e as Error).message}`);
        continue;
      }
      for (const e of events) {
        e.trigger = t.id;
        // Already handled at this version, or you said skip / it's waiting for you.
        const had = await getItem(b, itemKey(t, e.key));
        const status = had?.status;
        if (had && (status === "asked" || status === "skipped")) continue;
        if (had && status !== "error" && had.version === e.version) continue;
        if (!e.auto && !had) {
          await ask(b, t, e);
          asked.push(e);
          continue;
        }
        // The rest wait for the next check ("notify" needs no model, so it doesn't count).
        if (t.output !== "notify") {
          if (ran >= MAX_RUNS_PER_CHECK) continue;
          ran++;
        }
        await act(b, t, e);
      }
    }
    // In the bell: one line per thing it asks about, or one for the lot when there are many.
    if (asked.length > 3) await notifyBot(b, { title: `${asked.length} things to look at`, body: asked.slice(0, 3).map((e) => e.title).join(" · ") });
    else for (const e of asked) await notifyBot(b, { title: `Run this? ${e.title}`, target: { kind: "item", key: itemKey(spec.triggers.find((t) => t.id === e.trigger)!, e.key) } });
    if (errors.length) await notifyBot(b, { title: "Some checks failed", body: errors.join(" · ") });
    return { ran, asked: asked.length, errors };
  } finally {
    busy.delete(id);
  }
}

// Noted and notified, not run: you pick Run it or Skip.
async function ask(b: Bot, t: Trigger, e: Event) {
  const now = new Date().toISOString();
  return putItem(b, { key: itemKey(t, e.key), trigger: t.id, triggerTitle: t.title, kind: t.output === "notes" ? "notes" : t.output === "notify" ? "notify" : "draft", title: e.title, url: e.url, context: e.context, version: e.version, status: "asked", createdAt: now, updatedAt: now });
}

// "Run it" on an item it asked about, or "Run now" on a trigger.
export async function runItem(id: string, key: string) {
  const b = await getBot(id);
  const it = b && (await getItem(b, key));
  if (!b || !it) throw new Error("Item not found.");
  const spec = await readSpec(b.dir);
  const t = spec.triggers.find((x) => x.id === it.trigger);
  if (!t) throw new Error(`bot.yaml has no trigger "${it.trigger}" anymore.`);
  return runPlaybook(b, t, { key, version: it.version, title: it.title, url: it.url, context: it.context, auto: true }, it);
}

export async function runTriggerNow(id: string, triggerId: string) {
  const b = await getBot(id);
  if (!b) throw new Error("Bot not found.");
  const spec = await readSpec(b.dir);
  const t = spec.triggers.find((x) => x.id === triggerId);
  if (!t) throw new Error("No such trigger.");
  // A trigger that watches something: check it now. One that doesn't (schedule, manual): run its playbook now.
  if (t.on !== "schedule" && t.on !== "manual") return checkBot(id, true, t.id);
  const stamp = new Date().toISOString();
  const e: Event = { key: `now-${stamp.replace(/[:.]/g, "-")}`, version: stamp, title: `${t.title} (run by hand)`, context: `Run by hand at ${stamp}.`, auto: true };
  return act(b, t, e);
}

export async function setItem(id: string, key: string, status: "skipped" | "done") {
  const b = await getBot(id);
  const it = b && (await getItem(b, key));
  if (!b || !it) throw new Error("Item not found.");
  const next = { ...it, status, updatedAt: new Date().toISOString() };
  await putItem(b, next);
  return next;
}

// What a finished session said, for a playbook that wants more than its title.
export async function sessionText(id: string) {
  const s = await getSession(id);
  return s?.messages.map((m) => `${m.role}: ${m.blocks.map((x) => (x.kind === "text" ? x.text : "")).join(" ")}`).join("\n").slice(-20_000) ?? "";
}

// While Vlens runs: every minute, check the bots whose automation is on.
export function startBots() {
  g.lensBotTimer ??= setInterval(() => {
    void listBots().then(async (bots) => {
      for (const b of bots) {
        const fresh = await getBot(b.id);
        if (fresh?.automation && !busy.has(b.id)) void checkBot(b.id).catch(() => {});
      }
    });
  }, 60_000);
}
