import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { SubThread } from "./types";

// Sub-threads live in the app's own folder, not in ~/.claude, so we never
// touch the CLI's files.
const STORE = path.join(process.cwd(), "data", "threads.json");

type Store = Record<string, SubThread>;

let writeQueue: Promise<unknown> = Promise.resolve();

async function load(): Promise<Store> {
  try {
    return JSON.parse(await fs.readFile(STORE, "utf8"));
  } catch {
    return {};
  }
}

async function save(store: Store) {
  await fs.mkdir(path.dirname(STORE), { recursive: true });
  const tmp = STORE + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(store, null, 2));
  await fs.rename(tmp, STORE);
}

// Serialize read-modify-write so two streams finishing at once don't clobber each other.
export function updateStore<T>(fn: (s: Store) => T): Promise<T> {
  const next = writeQueue.then(async () => {
    const s = await load();
    const result = fn(s);
    await save(s);
    return result;
  });
  writeQueue = next.catch(() => {});
  return next;
}

export async function threadsForSession(rootSessionId: string): Promise<SubThread[]> {
  const s = await load();
  return Object.values(s)
    .filter((t) => t.rootSessionId === rootSessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getThread(id: string) {
  return (await load())[id] ?? null;
}

// Each sub-agent run creates a real CLI session file. Hide those from the
// sidebar so it only lists the user's own sessions.
export async function subThreadSessionIds(): Promise<Set<string>> {
  const s = await load();
  return new Set(Object.values(s).map((t) => t.claudeSessionId).filter((x): x is string => !!x));
}
