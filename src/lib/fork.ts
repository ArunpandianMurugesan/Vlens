"use client";

// Fork a session (like vTower's Fork, `claude --resume <id> --fork-session`):
// a copy with its whole history, in the same folder. The original stays as it is.
// terminal: open the copy in Terminal instead of in Vlens.
export async function forkSession(id: string, terminal = false): Promise<{ id?: string; title?: string }> {
  const r = await fetch(`/api/sessions/${id}/fork`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ terminal }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? "Couldn't fork it.");
  if (d.id) made.set(d.id, Date.now());
  return d;
}

// Forks made here in the last minute: Vlens wrote them, so they aren't "live" (changed by something else).
const made = new Map<string, number>();
export const justForked = (id: string) => Date.now() - (made.get(id) ?? 0) < 60_000;
