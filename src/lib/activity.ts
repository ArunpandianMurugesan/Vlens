import "server-only";
import { jsonStore } from "./jsonStore";

// A short log of what happened on PRs from Vlens (reviews started, posts, approvals),
// kept on this Mac (activity.json in Vlens's data folder). Write-only for now: it's the
// raw material for "what Vlens did for you" numbers later.

export type ActivityKind = "reviewed" | "posted" | "skipped" | "error";
export interface Activity {
  at: string;
  kind: ActivityKind;
  url?: string;
  title?: string;
  detail: string;
}

const store = jsonStore<Activity[]>("activity.json", () => []);
const KEEP = 500;

export function logActivity(a: Omit<Activity, "at">) {
  return store
    // jsonStore writes back the object it handed over, so edit it in place.
    .update((all) => {
      if (!Array.isArray(all)) return;
      all.unshift({ ...a, at: new Date().toISOString() });
      if (all.length > KEEP) all.length = KEEP;
    })
    .catch(() => {}); // a log line never fails the action it describes
}
