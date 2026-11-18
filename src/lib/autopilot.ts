import "server-only";
import { type Activity, type AutopilotRules, type AutopilotState, normalizeRules, type PrTrack } from "./autopilotPlan";
import { jsonStore } from "./jsonStore";
import { runnerStatus } from "./autopilotStatus";
import { allRecords } from "./reviewRecords";

// Autopilot's settings and log, kept on this Mac (autopilot.json in Vlens's data
// folder). The plan for each PR is worked out from these in autopilotPlan.ts.

interface Saved {
  rules?: unknown;
  paused?: Record<string, string>;
  activity?: Activity[];
  failed?: AutopilotState["failed"];
  handed?: Record<string, string>; // PR url -> head sha already logged as handed to you
}
const store = jsonStore<Saved>("autopilot.json", () => ({}));
const KEEP = 200; // activity entries kept

export async function autopilotState(): Promise<AutopilotState> {
  const [saved, records] = await Promise.all([store.load(), allRecords()]);
  const tracks: Record<string, PrTrack> = {};
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  let today = 0;
  for (const [url, r] of Object.entries(records)) {
    const run = r.runs.at(-1);
    const post = r.posts.at(-1);
    tracks[url] = { lastRun: run ? { headSha: run.headSha, at: run.at, sessionId: run.sessionId, ...(run.by ? { by: run.by } : {}) } : null, lastPost: post ? { headSha: post.headSha, at: post.at, url: post.url } : null };
    today += r.runs.filter((x) => !x.carried && Date.parse(x.at) >= startOfDay.getTime()).length;
  }
  const rt = runnerStatus();
  return { rules: normalizeRules(saved.rules), paused: saved.paused ?? {}, activity: saved.activity ?? [], tracks, today, failed: saved.failed ?? {}, running: rt.running, lastCheck: rt.lastCheck };
}

// The runner's memory between runs: a failed review isn't retried at the same commit,
// and a hand-off is logged once per commit.
export function setFailed(url: string, f: AutopilotState["failed"][string] | null) {
  return store.update((s) => {
    const all = { ...(s.failed ?? {}) };
    if (f) all[url] = f;
    else delete all[url];
    s.failed = all;
  });
}
export async function handedAlready(url: string, sha: string) {
  return (await store.load()).handed?.[url] === sha;
}
export function markHanded(url: string, sha: string) {
  return store.update((s) => {
    s.handed = { ...(s.handed ?? {}), [url]: sha };
  });
}

export function logActivity(a: Omit<Activity, "at">) {
  return store.update((s) => {
    s.activity = [{ ...a, at: new Date().toISOString() }, ...(s.activity ?? [])].slice(0, KEEP);
  });
}

export function saveRules(rules: unknown): Promise<AutopilotRules> {
  const clean = normalizeRules(rules);
  return store.update((s) => {
    const was = normalizeRules(s.rules);
    s.rules = clean;
    if (was.enabled !== clean.enabled)
      s.activity = [{ at: new Date().toISOString(), kind: "rules" as const, detail: clean.enabled ? "Autopilot switched on" : "Autopilot switched off" }, ...(s.activity ?? [])].slice(0, KEEP);
    return clean;
  });
}

export function setPaused(url: string, title: string | undefined, paused: boolean) {
  return store.update((s) => {
    const p = { ...(s.paused ?? {}) };
    if (paused) p[url] = new Date().toISOString();
    else delete p[url];
    s.paused = p;
    s.activity = [{ at: new Date().toISOString(), kind: paused ? ("paused" as const) : ("resumed" as const), url, title, detail: paused ? "You paused autopilot for this PR" : "You resumed autopilot for this PR" }, ...(s.activity ?? [])].slice(0, KEEP);
  });
}
