import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";

// What a bot watches and may do, as files in its folder (ideas from the dev
// agent harness's agent.yaml, shaped for Vlens and the connectors you have):
//
//   bot.yaml     its triggers: what to watch (a connector + filters), whether to
//                run on its own or ask you first, which playbook to follow, what
//                comes out, and which actions it may take once you approve.
//   values.yaml  your own settings that the triggers point at with $name (your
//                repos, your Jira project…). Sharing a bot shares bot.yaml and
//                its playbooks, not your values.
//
// Filters run before any model, so an event they drop costs nothing.

export type TriggerSource = "schedule" | "session.finished" | "jira.issue" | "manual";
export type RunMode = "auto" | "ask" | "off";
export type Output = "draft" | "notes" | "notify";

export interface Trigger {
  id: string;
  title: string;
  on: TriggerSource;
  run: RunMode; // auto: runs on its own; ask: notifies you and waits; off: ignored
  playbook: string; // knowledge/playbooks/… it follows
  output: Output; // draft: a text for you; notes: written into its knowledge; notify: just tell you (no model)
  actions: string[]; // what it may do after you approve (none built yet)
  every: number; // minutes between checks
  // schedule
  at?: string; // "09:00", local time
  days?: string[]; // mon…sun; default every day
  // session.finished
  folders?: string[];
  // jira.issue
  jql?: string;
}

export interface Spec {
  connectors: string[]; // MCP servers it may use
  triggers: Trigger[];
  values: Record<string, unknown>;
  error?: string; // what's wrong with the files, if anything
}

const SOURCES: TriggerSource[] = ["schedule", "session.finished", "jira.issue", "manual"];
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" && v ? [v] : []);

// "$repos" -> values.repos
function resolve(v: unknown, values: Record<string, unknown>): unknown {
  if (typeof v === "string" && /^\$[\w-]+$/.test(v)) return values[v.slice(1)];
  if (Array.isArray(v)) return v.flatMap((x) => {
    const r = resolve(x, values);
    return Array.isArray(r) ? r : [r];
  });
  return v;
}

function trigger(raw: Record<string, unknown>, values: Record<string, unknown>, i: number): Trigger {
  const r = (k: string) => resolve(raw[k], values);
  const on = String(raw.on ?? "manual") as TriggerSource;
  if (!SOURCES.includes(on)) throw new Error(`Trigger ${i + 1}: "on: ${on}" isn't one of ${SOURCES.join(", ")}.`);
  const run = String(raw.run ?? "ask") as RunMode;
  if (!["auto", "ask", "off"].includes(run)) throw new Error(`Trigger ${i + 1}: "run" is auto, ask or off.`);
  const output = String(raw.output ?? "draft") as Output;
  if (!["draft", "notes", "notify"].includes(output)) throw new Error(`Trigger ${i + 1}: "output" is draft, notes or notify.`);
  const t: Trigger = {
    id: String(raw.id ?? `trigger-${i + 1}`).replace(/[^\w-]/g, "-"),
    title: String(raw.title ?? raw.id ?? on),
    on,
    run,
    playbook: String(raw.playbook ?? ""),
    output,
    actions: list(r("actions")),
    every: Math.min(Math.max(Number(raw.every) || (on === "schedule" ? 1 : 10), 1), 1440),
  };
  if (on === "schedule") {
    t.at = /^\d{1,2}:\d{2}$/.test(String(raw.at ?? "")) ? String(raw.at) : "09:00";
    t.days = list(r("days")).map((d) => d.slice(0, 3).toLowerCase());
  }
  if (on === "session.finished") t.folders = list(r("folders"));
  if (on === "jira.issue") {
    t.jql = String(r("jql") ?? "");
    if (!t.jql) throw new Error(`Trigger ${i + 1}: a jira.issue trigger needs "jql".`);
    t.every = Math.max(t.every, 15); // each check is a small model run
  }
  return t;
}

export async function readSpec(dir: string): Promise<Spec> {
  const [specText, valuesText] = await Promise.all([
    fs.readFile(path.join(dir, "bot.yaml"), "utf8").catch(() => ""),
    fs.readFile(path.join(dir, "values.yaml"), "utf8").catch(() => ""),
  ]);
  try {
    const values = ((valuesText && yaml.load(valuesText)) || {}) as Record<string, unknown>;
    const raw = ((specText && yaml.load(specText)) || {}) as Record<string, unknown>;
    const triggers = (Array.isArray(raw.triggers) ? raw.triggers : []).map((t, i) => trigger(t as Record<string, unknown>, values, i));
    const ids = new Set<string>();
    for (const t of triggers) {
      if (ids.has(t.id)) throw new Error(`Two triggers are called "${t.id}".`);
      ids.add(t.id);
    }
    return { connectors: list(raw.connectors), triggers, values };
  } catch (e) {
    return { connectors: [], triggers: [], values: {}, error: (e as Error).message };
  }
}

export const readSpecFiles = async (dir: string) => ({
  bot: await fs.readFile(path.join(dir, "bot.yaml"), "utf8").catch(() => ""),
  values: await fs.readFile(path.join(dir, "values.yaml"), "utf8").catch(() => ""),
});

// Saves the files, but only if they read back as a valid spec.
export async function writeSpecFiles(dir: string, files: { bot?: string; values?: string }) {
  const tmp = path.join(dir, ".spec-check");
  await fs.mkdir(tmp, { recursive: true });
  const now = await readSpecFiles(dir);
  await fs.writeFile(path.join(tmp, "bot.yaml"), files.bot ?? now.bot);
  await fs.writeFile(path.join(tmp, "values.yaml"), files.values ?? now.values);
  const check = await readSpec(tmp);
  await fs.rm(tmp, { recursive: true, force: true });
  if (check.error) throw new Error(check.error);
  if (files.bot !== undefined) await fs.writeFile(path.join(dir, "bot.yaml"), files.bot);
  if (files.values !== undefined) await fs.writeFile(path.join(dir, "values.yaml"), files.values);
  return check;
}
