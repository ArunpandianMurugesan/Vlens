import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "./paths";

// A small JSON file in Vlens's data folder (never in ~/.claude).
// Writes are queued so two requests don't clobber each other. The queue lives on
// globalThis, keyed by file: route modules can load their own copy of this module,
// and they must still share one queue per file.
const g = globalThis as unknown as { __lensJsonQueues?: Map<string, Promise<unknown>> };
const queues = (g.__lensJsonQueues ??= new Map());

export function jsonStore<T>(name: string, empty: () => T) {
  const file = path.join(DATA_DIR, name);

  async function load(): Promise<T> {
    let raw: string;
    try {
      raw = await fs.readFile(file, "utf8");
    } catch {
      return empty(); // not written yet
    }
    try {
      return JSON.parse(raw);
    } catch {
      // Don't let the next write replace it with an empty file: keep the bad copy
      // next to it so nothing is lost, and start fresh.
      await fs.rename(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
      console.error(`[vlens] ${name} couldn't be read; moved it aside as ${name}.corrupt-*`);
      return empty();
    }
  }

  function update<R>(fn: (data: T) => R): Promise<R> {
    const next = (queues.get(file) ?? Promise.resolve()).then(async () => {
      const data = await load();
      const result = fn(data);
      await writeJsonAtomic(file, data);
      return result;
    });
    queues.set(file, next.catch(() => {}));
    return next;
  }

  return { load, update };
}

// Write to a temp file with a unique name, then rename: a reader never sees half a
// file, and two writers never rename each other's temp file.
export async function writeJsonAtomic(file: string, data: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, file);
}
