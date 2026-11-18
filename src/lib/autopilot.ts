import "server-only";
import { type Activity, type AutopilotRules, type AutopilotState, normalizeRules, type PrTrack } from "./autopilotPlan";
import { jsonStore } from "./jsonStore";
import { allRecords } from "./reviewRecords";

// Autopilot's settings and log, kept on this Mac (autopilot.json in Vlens's data
// folder). The plan for each PR is worked out from these in autopilotPlan.ts.

interface Saved {
  rules?: unknown;
  paused?: Record<string, string>;
  activity?: Activity[];
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
    tracks[url] = { lastRun: run ? { headSha: run.headSha, at: run.at } : null, lastPost: post ? { headSha: post.headSha, at: post.at, url: post.url } : null };
    today += r.runs.filter((x) => Date.parse(x.at) >= startOfDay.getTime()).length;
  }
  return { rules: normalizeRules(saved.rules), paused: saved.paused ?? {}, activity: saved.activity ?? [], tracks, today };
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
