import "server-only";
import { jsonStore } from "./jsonStore";
import type { SubThread } from "./types";

const store = jsonStore<Record<string, SubThread>>("threads.json", () => ({}));

export const updateStore = store.update;

export async function threadsForSession(rootSessionId: string): Promise<SubThread[]> {
  const s = await store.load();
  return Object.values(s)
    .filter((t) => t.rootSessionId === rootSessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getThread(id: string) {
  return (await store.load())[id] ?? null;
}

// Each sub-agent run creates a real CLI session file. Hide those from the
// sidebar so it only lists the user's own sessions.
export async function subThreadSessionIds(): Promise<Set<string>> {
  const s = await store.load();
  return new Set(Object.values(s).map((t) => t.claudeSessionId).filter((x): x is string => !!x));
}
