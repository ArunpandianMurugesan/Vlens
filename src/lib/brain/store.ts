import "server-only";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { DATA_DIR } from "../paths";
import { embed, similarity } from "./embed";
import { detectThings, LINK_RELS, type LinkRel, normalize, type ThingRef, thingId, type ThingType } from "./things";

// The Vlens brain: one shared memory of your work, for bots only. Lives in Vlens's
// data folder (never in ~/.claude), so your normal Claude sessions don't see it;
// bots reach it only through their brain tools (lib/botAgent.ts), when their
// bot.md switches it on. Search is by meaning (local embeddings, ./embed.ts).
//
// Memories are connected: each is about things (tickets, PRs, repos, people,
// projects, files, teams), things relate to each other ("XPAN-95 implemented by
// galaxy#35799"), and memories link to each other ("replaces", "caused by",
// "fixes"). Each memory keeps its context: why, when, and where (folder, branch,
// session or bot).
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
  folder?: string | null; // the folder it came from (a session's); none = general, every bot with the brain sees it
  sources: MemorySource[];
  createdAt: string;
  updatedAt: string;
  uses: number; // times a bot read it
  lastUsed: string | null;
  history: { title: string; text: string; at: string; by: string }[]; // earlier versions, newest first
  why?: string; // the reason behind it
  when?: string; // when it happened (else: when it was saved)
  branch?: string | null; // the git branch it came from
  things?: string[]; // what it's about (thing ids, "ticket:XPAN-95")
  links?: { to: string; rel: LinkRel }[]; // to other memories
  supersededBy?: string | null; // a newer memory replaces this one (it stays, ranked lower)
  vector: number[];
}

export interface Thing {
  id: string; // "ticket:XPAN-95"
  type: ThingType;
  key: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}
export interface Relation {
  id: string;
  from: string; // thing id
  rel: string; // "implemented by", "in", "owns", "reviews", "includes", …
  to: string; // thing id
  memory: string | null; // the memory it was learned from
  at: string;
}

export type MemoryView = Omit<Memory, "vector">;

const FILE = path.join(DATA_DIR, "brain", "memories.json");
type Data = { version: 1; memories: Memory[]; forgotten: (Memory & { forgottenAt: string; by: string })[]; things?: Thing[]; relations?: Relation[] };

const g = globalThis as { lensBrain?: Data; lensBrainQueue?: Promise<unknown> };

async function data(): Promise<Data> {
  if (!g.lensBrain)
    try {
      g.lensBrain = JSON.parse(await fs.readFile(FILE, "utf8")) as Data;
    } catch {
      g.lensBrain = { version: 1, memories: [], forgotten: [] };
    }
  const d = g.lensBrain;
  if (d.things && d.relations && d.memories.every((m) => m.things)) return d;
  d.things ??= [];
  d.relations ??= [];
  // Memories from before things: find the obvious ones in their text.
  for (const m of d.memories) if (!m.things) m.things = detectThings(`${m.title}\n${m.text}`).map((t) => upsert(d, t));
  return d;
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

// A thing, found or made (by its normalized id).
function upsert(d: Data, ref: ThingRef): string {
  const n = normalize(ref);
  const id = thingId(n);
  const now = new Date().toISOString();
  const t = d.things!.find((x) => x.id === id);
  if (t) {
    if (n.name && (!t.name || t.name === t.key)) t.name = n.name;
    t.updatedAt = now;
  } else d.things!.push({ id, type: n.type, key: n.key, name: n.name ?? n.key, createdAt: now, updatedAt: now });
  return id;
}
const refsOf = (d: Data, refs: ThingRef[] | undefined, text: string) => [...new Set([...detectThings(text), ...(refs ?? [])].filter((r) => r?.key && r.type).map((r) => upsert(d, r)))];
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
  folder?: string | null;
  why?: string;
  when?: string;
  branch?: string | null;
  things?: ThingRef[]; // more than the ones found in its text (people, projects…)
  links?: { to: string; rel: LinkRel }[];
  source: Omit<MemorySource, "at">;
}

export async function addMemory(n: NewMemory): Promise<MemoryView> {
  const now = new Date().toISOString();
  const title = n.title.trim().slice(0, 200);
  const text = n.text.trim().slice(0, 4000);
  if (!title || !text) throw new Error("A memory needs a title and text.");
  const [vector] = await embed([`${title}\n${text}`]);
  return change((d) => {
    const links = (n.links ?? []).filter((l) => LINK_RELS.includes(l.rel) && d.memories.some((x) => x.id === l.to));
    const m: Memory = {
      id: randomUUID().slice(0, 12),
      title,
      text,
      kind: n.kind && KINDS.includes(n.kind) ? n.kind : "fact",
      importance: clamp(n.importance),
      tags: (n.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 12),
      pinned: false,
      folder: n.folder ?? null,
      sources: [{ ...n.source, at: now }],
      createdAt: now,
      updatedAt: now,
      uses: 0,
      lastUsed: null,
      history: [],
      why: n.why?.trim().slice(0, 1000) || undefined,
      when: n.when,
      branch: n.branch ?? null,
      things: refsOf(d, n.things, `${title}\n${text}`),
      links,
      supersededBy: null,
      vector,
    };
    d.memories.push(m);
    for (const l of links) if (l.rel === "supersedes") setSuperseded(d, l.to, m.id);
    return view(m);
  });
}

export async function updateMemory(
  id: string,
  p: Partial<Pick<Memory, "title" | "text" | "kind" | "importance" | "tags" | "pinned" | "why">> & { things?: ThingRef[]; links?: { to: string; rel: LinkRel }[]; by: string; source?: Omit<MemorySource, "at"> },
): Promise<MemoryView> {
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
    if (p.why !== undefined) m.why = p.why.trim().slice(0, 1000) || undefined;
    // Things and links only grow on an update (what it's about doesn't stop being true).
    m.things = [...new Set([...(m.things ?? []), ...refsOf(d, p.things, `${m.title}\n${m.text}`)])];
    for (const l of p.links ?? [])
      if (LINK_RELS.includes(l.rel) && l.to !== m.id && d.memories.some((x) => x.id === l.to) && !(m.links ?? []).some((x) => x.to === l.to && x.rel === l.rel)) {
        m.links = [...(m.links ?? []), l];
        if (l.rel === "supersedes") setSuperseded(d, l.to, m.id);
      }
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
// Can a bot limited to these folders see this memory? (No limit, or a general memory: yes.)
export const inFolders = (m: Pick<Memory, "folder">, folders?: string[] | null) =>
  !folders?.length || !m.folder || folders.some((f) => m.folder === f || m.folder!.startsWith(`${f}/`));

export async function searchMemories(q: string, o: { limit?: number; kind?: MemoryKind; folders?: string[] | null } = {}): Promise<(MemoryView & { score: number; match: number })[]> {
  const all = (await data()).memories.filter((m) => (!o.kind || m.kind === o.kind) && inFolders(m, o.folders));
  if (!q.trim() || !all.length) return [];
  const [qv] = await embed([q.trim()], "query");
  const now = Date.now();
  // Things the question names (a ticket key, a PR, a person's name): their memories count more.
  const named = namedThings((await data()).things!, q);
  return all
    .map((m) => {
      const match = similarity(qv, m.vector);
      const ageDays = (now - Date.parse(m.lastUsed ?? m.updatedAt)) / 86_400_000;
      const fresh = Math.exp(-ageDays / 60); // ~2 months half-life-ish
      const about = (m.things ?? []).some((t) => named.has(t)) ? 0.15 : 0;
      const score = match + about + 0.08 * m.importance + 0.04 * fresh + (m.pinned ? 0.05 : 0) - (m.supersededBy ? 0.1 : 0);
      return { ...view(m), score, match };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(Math.max(o.limit ?? 6, 1), 30));
}

// The closest memories to a piece of text (for the curator: is this new, or an update?).
export async function similarTo(t: string, limit = 5, folders?: string[] | null) {
  const all = (await data()).memories.filter((m) => inFolders(m, folders));
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

// ── Things, relations and links ──────────────────────────────────────────────

function setSuperseded(d: Data, oldId: string, newId: string) {
  const old = d.memories.find((x) => x.id === oldId);
  if (old && old.id !== newId) old.supersededBy = newId;
}

// Things a question mentions: by key (XPAN-95, galaxy#35799) or by name (Kavitha).
function namedThings(things: Thing[], q: string) {
  const ids = new Set(detectThings(q).map(thingId));
  const low = q.toLowerCase();
  for (const t of things) if ((t.key.length >= 3 && low.includes(t.key.toLowerCase())) || (t.name.length >= 3 && low.includes(t.name.toLowerCase()))) ids.add(t.id);
  return ids;
}

// "XPAN-95 implemented by galaxy#35799", learned from a memory. Same triple twice = one.
export async function relate(from: ThingRef, rel: string, to: ThingRef, memory: string | null = null) {
  const r = rel.trim().toLowerCase().replace(/_/g, " ").slice(0, 40);
  if (!r) return;
  await change((d) => {
    const a = upsert(d, from);
    const b = upsert(d, to);
    if (a === b || d.relations!.some((x) => x.from === a && x.rel === r && x.to === b)) return;
    d.relations!.push({ id: randomUUID().slice(0, 12), from: a, rel: r, to: b, memory, at: new Date().toISOString() });
  });
}

export async function listThings(o: { type?: ThingType } = {}) {
  const d = await data();
  const count = new Map<string, number>();
  for (const m of d.memories) for (const t of m.things ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  return d
    .things!.filter((t) => !o.type || t.type === o.type)
    .map((t) => ({ ...t, memories: count.get(t.id) ?? 0, relations: d.relations!.filter((r) => r.from === t.id || r.to === t.id).length }))
    .filter((t) => t.memories || t.relations)
    .sort((a, b) => b.memories - a.memories || b.updatedAt.localeCompare(a.updatedAt));
}

export async function findThing(key: string): Promise<Thing | null> {
  const d = await data();
  const k = key.trim().toLowerCase();
  const byId = d.things!.find((t) => t.id.toLowerCase() === k);
  if (byId) return byId;
  const det = detectThings(key).map(thingId);
  return d.things!.find((t) => det.includes(t.id)) ?? d.things!.find((t) => t.key.toLowerCase() === k || t.name.toLowerCase() === k) ?? null;
}

// The trail around a thing (or a memory): its memories (oldest first: the story),
// how it relates to other things, and what's known about those. Only memories
// the reader may see (folders) are included.
export async function trail(start: string, o: { folders?: string[] | null; depth?: 1 | 2 } = {}) {
  const d = await data();
  const visible = (m: Memory) => inFolders(m, o.folders);
  let thing = await findThing(start);
  const fromMemory = !thing ? d.memories.find((m) => m.id === start && visible(m)) : undefined;
  if (!thing && !fromMemory) return null;
  const centre = thing ? [thing.id] : (fromMemory!.things ?? []);
  if (!thing && centre.length) thing = d.things!.find((t) => t.id === centre[0]) ?? null;
  const story = (ids: string[]) =>
    d.memories
      .filter((m) => visible(m) && (m.things ?? []).some((t) => ids.includes(t)))
      .sort((a, b) => (a.when ?? a.createdAt).localeCompare(b.when ?? b.createdAt))
      .map(view);
  const rels = d.relations!.filter((r) => centre.includes(r.from) || centre.includes(r.to));
  const near = [...new Set(rels.flatMap((r) => [r.from, r.to]).filter((x) => !centre.includes(x)))];
  const byId = (id: string) => d.things!.find((t) => t.id === id) ?? null;
  return {
    thing,
    memory: fromMemory ? view(fromMemory) : null,
    memories: story(centre),
    relations: rels.map((r) => ({ from: byId(r.from), rel: r.rel, to: byId(r.to) })),
    near: o.depth === 1 ? [] : near.slice(0, 8).map((id) => ({ thing: byId(id), memories: story([id]).slice(-3) })),
    links: (fromMemory?.links ?? []).map((l) => ({ rel: l.rel, memory: d.memories.find((m) => m.id === l.to && visible(m)) })).filter((l) => l.memory).map((l) => ({ rel: l.rel, memory: view(l.memory!) })),
  };
}

// Names for a memory's things and links (for showing it).
export async function describe(m: MemoryView) {
  const d = await data();
  return {
    things: (m.things ?? []).map((id) => d.things!.find((t) => t.id === id)).filter((t): t is Thing => !!t),
    links: (m.links ?? []).map((l) => ({ rel: l.rel, id: l.to, title: d.memories.find((x) => x.id === l.to)?.title ?? "(forgotten)" })),
    supersededBy: m.supersededBy ? { id: m.supersededBy, title: d.memories.find((x) => x.id === m.supersededBy)?.title ?? "(forgotten)" } : null,
  };
}
