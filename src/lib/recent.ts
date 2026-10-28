import "server-only";
import { jsonStore } from "./jsonStore";

// Sessions Vlens itself started or replied in. They run as one-off `claude -p`
// processes, so they're not "active" once a reply is done; this keeps them on
// the sidebar under Recent until they age out or you remove them.
export const RECENT_HOURS = 24;
const KEEP_DAYS = 7;

const store = jsonStore<Record<string, string>>("recent.json", () => ({}));

export function markRecent(id: string) {
  return store.update((s) => {
    s[id] = new Date().toISOString();
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    for (const [k, at] of Object.entries(s)) if (Date.parse(at) < cutoff) delete s[k];
  });
}

export function forgetRecent(id: string) {
  return store.update((s) => void delete s[id]);
}

// id -> when Vlens last used it, for the ones inside the Recent window.
export async function recentSessions(): Promise<Map<string, string>> {
  const cutoff = Date.now() - RECENT_HOURS * 3_600_000;
  return new Map(Object.entries(await store.load()).filter(([, at]) => Date.parse(at) >= cutoff));
}
