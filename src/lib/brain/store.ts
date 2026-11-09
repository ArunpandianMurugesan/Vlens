import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../paths";
import { embed, similarity } from "./embed";

// The Vlens brain: one shared memory of your work, for bots only. Lives in Vlens's
// data folder (never in ~/.claude), so your normal Claude sessions don't see it;
// bots reach it only through their brain tools (lib/botAgent.ts), when their
// bot.md switches it on. Search is by meaning (local embeddings, ./embed.ts).
//
// One JSON file, kept in memory: plenty for thousands of memories.

export type MemoryKind = "decision" | "fact" | "howto" | "work" | "person" | "project";
export const KINDS: MemoryKind[] = ["decision", "fact", "howto", "work", "person", "project"];

export interface MemorySource {
  type: "session" | "bot" | "you";
  id?: string; // session id, bot id
  note?: string; // e.g. "turn 14", "galaxy#35799"
  at: string;
}

export interface Memory {
  id: string;
  title: string;
  text: string;
  kind: MemoryKind;
  importance: number; // 0..1
  tags: string[];
  pinned: boolean; // you pinned it: never fades
  sources: MemorySource[];
  createdAt: string;
  updatedAt: string;
  uses: number; // times a bot read it
  lastUsed: string | null;
  history: { title: string; text: string; at: string; by: string }[]; // earlier versions, newest first
  vector: number[];
}

export type MemoryView = Omit<Memory, "vector">;

const FILE = path.join(DATA_DIR, "brain", "memories.json");
type Data = { version: 1; memories: Memory[]; forgotten: (Memory & { forgottenAt: string; by: string })[] };

const g = globalThis as { lensBrain?: Data; lensBrainQueue?: Promise<unknown> };

async function data(): Promise<Data> {
  if (g.lensBrain) return g.lensBrain;
  try {
    g.lensBrain = JSON.parse(await fs.readFile(FILE, "utf8")) as Data;
  } catch {
    g.lensBrain = { version: 1, memories: [], forgotten: [] };
  }
  return g.lensBrain;
}

// One change at a time, saved straight after.
function change<R>(fn: (d: Data) => R | Promise<R>): Promise<R> {
  const next = (g.lensBrainQueue ?? Promise.resolve()).then(async () => {
    const d = await data();
    const r = await fn(d);
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(FILE + ".tmp", JSON.stringify(d));
    await fs.rename(FILE + ".tmp", FILE);
    return r;
  });
  g.lensBrainQueue = next.catch(() => {});
  return next;
}

const view = ({ vector: _v, ...m }: Memory): MemoryView => (void _v, m);
const clamp = (n: unknown, d = 0.5) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d);
const textOf = (m: Pick<Memory, "title" | "text">) => `${m.title}\n${m.text}`;

export async function listMemories(): Promise<MemoryView[]> {
  return (await data()).memories.map(view).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getMemory(id: string, o: { use?: boolean } = {}): Promise<MemoryView | null> {
  if (o.use) {
    return change((d) => {
      const m = d.memories.find((x) => x.id === id);
      if (!m) return null;
      m.uses++;
      m.lastUsed = new Date().toISOString();
      return view(m);
    });
  }
  const m = (await data()).memories.find((x) => x.id === id);
  return m ? view(m) : null;
}

export interface NewMemory {
  title: string;
  text: string;
  kind?: MemoryKind;
  importance?: number;
  tags?: string[];
  source: Omit<MemorySource, "at">;
}

export async function addMemory(n: NewMemory): Promise<MemoryView> {
  const now = new Date().toISOString();
  const title = n.title.trim().slice(0, 200);
  const text = n.text.trim().slice(0, 4000);
  if (!title || !text) throw new Error("A memory needs a title and text.");
  const [vector] = await embed([`${title}\n${text}`]);
  return change((d) => {
    const m: Memory = {
      id: randomUUID().slice(0, 12),
      title,
      text,
      kind: n.kind && KINDS.includes(n.kind) ? n.kind : "fact",
      importance: clamp(n.importance),
      tags: (n.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12),
      pinned: false,
      sources: [{ ...n.source, at: now }],
      createdAt: now,
      updatedAt: now,
      uses: 0,
      lastUsed: null,
      history: [],
      vector,
    };
    d.memories.push(m);
    return view(m);
  });
}

export async function updateMemory(id: string, p: Partial<Pick<Memory, "title" | "text" | "kind" | "importance" | "tags" | "pinned">> & { by: string; source?: Omit<MemorySource, "at"> }): Promise<MemoryView> {
  const cur = (await data()).memories.find((x) => x.id === id);
  if (!cur) throw new Error("No memory with that id.");
  const title = p.title?.trim().slice(0, 200) || cur.title;
  const text = p.text?.trim().slice(0, 4000) || cur.text;
  const reembed = title !== cur.title || text !== cur.text;
  const vector = reembed ? (await embed([`${title}\n${text}`]))[0] : null;
  return change((d) => {
    const m = d.memories.find((x) => x.id === id);
    if (!m) throw new Error("No memory with that id.");
    const now = new Date().toISOString();
    if (reembed) m.history = [{ title: m.title, text: m.text, at: m.updatedAt, by: p.by }, ...m.history].slice(0, 10);
    m.title = title;
    m.text = text;
    if (vector) m.vector = vector;
    if (p.kind && KINDS.includes(p.kind)) m.kind = p.kind;
    if (p.importance !== undefined) m.importance = clamp(p.importance, m.importance);
    if (p.tags) m.tags = p.tags.map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12);
    if (typeof p.pinned === "boolean") m.pinned = p.pinned;
    if (p.source) m.sources = [...m.sources, { ...p.source, at: now }].slice(-20);
    m.updatedAt = now;
    return view(m);
  });
}

// Forgotten memories are kept aside (last 200), so you can bring one back.
export async function forgetMemory(id: string, by: string): Promise<void> {
  await change((d) => {
    const i = d.memories.findIndex((x) => x.id === id);
    if (i < 0) throw new Error("No memory with that id.");
    const [m] = d.memories.splice(i, 1);
    d.forgotten = [{ ...m, forgottenAt: new Date().toISOString(), by }, ...(d.forgotten ?? [])].slice(0, 200);
  });
}

export async function restoreMemory(id: string): Promise<MemoryView> {
  return change((d) => {
    const i = (d.forgotten ?? []).findIndex((x) => x.id === id);
    if (i < 0) throw new Error("Not in the forgotten list.");
    const [{ forgottenAt: _f, by: _b, ...m }] = d.forgotten.splice(i, 1);
    void [_f, _b];
    d.memories.push(m);
    return view(m);
  });
}

export async function listForgotten() {
  return ((await data()).forgotten ?? []).map(({ vector: _v, ...m }) => (void _v, m));
}

// Search by meaning. The score is mostly how close the meaning is, nudged up by
// importance and by being recent or used (so stale, minor memories sink).
export async function searchMemories(q: string, o: { limit?: number; kind?: MemoryKind } = {}): Promise<(MemoryView & { score: number; match: number })[]> {
  const all = (await data()).memories.filter((m) => !o.kind || m.kind === o.kind);
  if (!q.trim() || !all.length) return [];
  const [qv] = await embed([q.trim()], "query");
  const now = Date.now();
  return all
    .map((m) => {
      const match = similarity(qv, m.vector);
      const ageDays = (now - Date.parse(m.lastUsed ?? m.updatedAt)) / 86_400_000;
      const fresh = Math.exp(-ageDays / 60); // ~2 months half-life-ish
      const score = match + 0.08 * m.importance + 0.04 * fresh + (m.pinned ? 0.05 : 0);
      return { ...view(m), score, match };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(o.limit ?? 6, 1), 30));
}

// The closest memories to a piece of text (for the curator: is this new, or an update?).
export async function similarTo(t: string, limit = 5) {
  const all = (await data()).memories;
  if (!all.length) return [];
  const [v] = await embed([t]);
  return all
    .map((m) => ({ ...view(m), match: similarity(v, m.vector) }))
    .sort((a, b) => b.match - a.match)
    .slice(0, limit);
}

export { textOf };

// ── For reflection (./reflect.ts) ─────────────────────────────────────────────

// Every memory with its vector, as it is (don't change these objects).
export async function rawMemories(): Promise<readonly Memory[]> {
  return (await data()).memories;
}

// Tune a memory's importance without counting it as an edit (no new version, same date).
export async function adjustMemory(id: string, p: { importance?: number; reflectedUses?: number }) {
  await change((d) => {
    const m = d.memories.find((x) => x.id === id) as (Memory & { reflectedUses?: number }) | undefined;
    if (!m) return;
    if (p.importance !== undefined) m.importance = clamp(p.importance, m.importance);
    if (p.reflectedUses !== undefined) m.reflectedUses = p.reflectedUses;
  });
}
