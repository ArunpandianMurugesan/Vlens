import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { activeSessions } from "./active";
import { DATA_DIR } from "./paths";
import { setPinned } from "./pins";
import { forgetRecent } from "./recent";
import { findSessionFile } from "./sessions";
import { updateStore } from "./threads";

// Same line the CLI's /rename writes, so `claude --resume` shows the new name too.
export async function renameSession(id: string, title: string) {
  const found = await findSessionFile(id);
  if (!found) return false;
  const line = JSON.stringify({ type: "custom-title", customTitle: title, sessionId: id });
  await fs.appendFile(found.file, "\n" + line + "\n");
  return true;
}

const TRASH = path.join(DATA_DIR, "trash");

// Moves a session's files out of ~/.claude into Lens's trash/<project>/, so a
// delete can be undone by moving them back.
async function trashFiles(id: string) {
  const found = await findSessionFile(id);
  if (!found) return;
  const dest = path.join(TRASH, found.dir);
  await fs.mkdir(dest, { recursive: true });
  const stamp = Date.now();
  const src = path.dirname(found.file);
  for (const name of [`${id}.jsonl`, id]) {
    // The folder next to the file holds the session's own sub-agent transcripts.
    await fs.rename(path.join(src, name), path.join(dest, `${stamp}-${name}`)).catch(() => {});
  }
}

export type DeleteResult = { ok: true } | { ok: false; status: number; error: string };

export async function deleteSession(id: string): Promise<DeleteResult> {
  if (!(await findSessionFile(id))) return { ok: false, status: 404, error: "Session not found." };
  if ((await activeSessions()).has(id))
    return { ok: false, status: 409, error: "This session is still running. End it first." };

  // Drop this session's sub-agent threads too, and the CLI sessions they created.
  const subSessions = await updateStore((s) => {
    const ids: string[] = [];
    for (const [tid, t] of Object.entries(s)) {
      if (t.rootSessionId !== id) continue;
      if (t.claudeSessionId) ids.push(t.claudeSessionId);
      delete s[tid];
    }
    return ids;
  });
  await Promise.all([id, ...subSessions].map(trashFiles));
  await setPinned(id, false);
  await forgetRecent(id);
  return { ok: true };
}
