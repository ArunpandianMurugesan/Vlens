import "server-only";
import { jsonStore } from "./jsonStore";

// Archived sessions: out of the sidebar's Pinned, Active and Recent lists,
// kept in an Archived list to open again later. The session files stay where
// they are; this is only Vlens's list (session id -> when it was archived).
const store = jsonStore<Record<string, string>>("archive.json", () => ({}));

export async function archivedSessions(): Promise<Record<string, string>> {
  return store.load();
}

export function setArchived(id: string, archived: boolean) {
  return store.update((all) => {
    if (archived) all[id] ??= new Date().toISOString();
    else delete all[id];
  });
}
