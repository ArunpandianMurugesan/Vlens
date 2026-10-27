import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

// A small JSON file in the app's data/ folder (never in ~/.claude).
// Writes are queued so two requests don't clobber each other.
export function jsonStore<T>(name: string, empty: () => T) {
  const file = path.join(process.cwd(), "data", name);
  let queue: Promise<unknown> = Promise.resolve();

  async function load(): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      return empty();
    }
  }

  function update<R>(fn: (data: T) => R): Promise<R> {
    const next = queue.then(async () => {
      const data = await load();
      const result = fn(data);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file + ".tmp", JSON.stringify(data, null, 2));
      await fs.rename(file + ".tmp", file);
      return result;
    });
    queue = next.catch(() => {});
    return next;
  }

  return { load, update };
}
