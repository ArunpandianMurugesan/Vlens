import "server-only";
import { jsonStore } from "./jsonStore";

// Pinned sessions stay in the sidebar even when no Claude process has them open.
const store = jsonStore<string[]>("pins.json", () => []);

// Pinned ids in the order they were pinned.
export async function pinnedIds(): Promise<string[]> {
  return store.load();
}

export function setPinned(id: string, pinned: boolean) {
  return store.update((ids) => {
    const i = ids.indexOf(id);
    if (pinned && i < 0) ids.push(id);
    if (!pinned && i >= 0) ids.splice(i, 1);
  });
}
