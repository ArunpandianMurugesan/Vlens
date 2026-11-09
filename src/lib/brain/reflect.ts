import "server-only";
import os from "node:os";
import { jsonStore } from "../jsonStore";
import { runClaudeOnce } from "../runClaude";
import { similarity } from "./embed";
import { brainActivity, type BrainActivity, logActivity } from "./learn";
import { adjustMemory, forgetMemory, KINDS, type Memory, type MemoryKind, rawMemories, updateMemory } from "./store";

// Reflection: the brain tidies itself when it's quiet. Pinned memories are never
// touched. Each step is logged, and what it forgets can be brought back.
//   strengthen  memories bots keep reading get more important
//   fade        memories nobody used for a month slowly lose importance; tiny,
//               long-unused ones are forgotten
//   merge       near-duplicates become one memory (a small Claude call per group)

const EVERY_MS = 12 * 60 * 60_000;
const QUIET_MS = 20 * 60_000; // no learning for this long first
const MERGE_AT = 0.88; // this close in meaning = the same thing said twice
const MAX_GROUPS = 6;

const last = jsonStore<{ at: string | null }>("brain/reflect.json", () => ({ at: null }));
const g = globalThis as { lensBrainReflecting?: boolean };

export async function lastReflection() {
  return (await last.load()).at;
}

export async function reflectIfDue() {
  const at = (await last.load()).at;
  if (at && Date.now() - Date.parse(at) < EVERY_MS) return;
  const learned = (await brainActivity()).find((a) => a.kind === "learn");
  if (learned && Date.now() - Date.parse(learned.at) < QUIET_MS) return;
  if (!(await rawMemories()).length) return;
  await reflect();
}

export async function reflect() {
  if (g.lensBrainReflecting) return { ops: [] as BrainActivity["ops"] };
  g.lensBrainReflecting = true;
  const ops: BrainActivity["ops"] = [];
  try {
    const prev = (await last.load()).at;
    const weeks = prev ? Math.min((Date.now() - Date.parse(prev)) / (7 * 86_400_000), 8) : 0;
    const now = Date.now();
    const mems = [...(await rawMemories())] as (Memory & { reflectedUses?: number })[];

    // Strengthen and fade.
    for (const m of mems) {
      if (m.pinned) continue;
      const newUses = m.uses - (m.reflectedUses ?? 0);
      const idleDays = (now - Date.parse(m.lastUsed ?? m.updatedAt)) / 86_400_000;
      if (newUses >= 3 && m.importance < 0.95) {
        await adjustMemory(m.id, { importance: Math.min(0.95, m.importance + 0.05 * Math.min(newUses, 6)), reflectedUses: m.uses });
        ops.push({ op: "strengthen", id: m.id, title: m.title, why: `used ${newUses}× since last time` });
      } else if (newUses > 0) await adjustMemory(m.id, { reflectedUses: m.uses });
      else if (idleDays > 30 && weeks > 0) {
        const next = m.importance * Math.pow(0.95, weeks);
        if (next < 0.15 && idleDays > 60) {
          await forgetMemory(m.id, "reflection: minor and unused for 2 months");
          ops.push({ op: "fade", id: m.id, title: m.title, why: "minor and unused for 2 months: forgotten" });
        } else if (m.importance - next > 0.01) await adjustMemory(m.id, { importance: next });
      }
    }

    // Merge near-duplicates (groups of memories that say the same thing).
    const live = [...(await rawMemories())].filter((m) => !m.pinned).slice(0, 3000);
    const parent = new Map<string, string>();
    const find = (x: string): string => (parent.get(x) === x || !parent.has(x) ? x : find(parent.get(x)!));
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++)
        if (similarity(live[i].vector, live[j].vector) >= MERGE_AT) {
          parent.set(live[i].id, find(live[i].id));
          parent.set(live[j].id, find(live[j].id));
          parent.set(find(live[j].id), find(live[i].id));
        }
    const groups = new Map<string, Memory[]>();
    for (const m of live) if (parent.has(m.id)) groups.set(find(m.id), [...(groups.get(find(m.id)) ?? []), m]);
    for (const group of [...groups.values()].filter((x) => x.length > 1).slice(0, MAX_GROUPS)) {
      const merged = await mergeText(group.slice(0, 6));
      if (!merged) continue;
      const keep = [...group].sort((a, b) => b.importance - a.importance || b.uses - a.uses)[0];
      await updateMemory(keep.id, { ...merged, importance: Math.max(...group.map((x) => x.importance)), by: "reflection" });
      for (const m of group) if (m.id !== keep.id) await forgetMemory(m.id, `reflection: merged into ${keep.id}`);
      ops.push({ op: "merge", id: keep.id, title: merged.title, why: `${group.length} memories said the same thing` });
    }

    await last.update((s) => void (s.at = new Date().toISOString()));
    await logActivity({ kind: "reflect", ops, note: ops.length ? undefined : "Nothing to tidy." });
    return { ops };
  } finally {
    g.lensBrainReflecting = false;
  }
}

async function mergeText(group: Memory[]): Promise<{ title: string; text: string; kind: MemoryKind } | null> {
  const prompt = `These memories from the Vlens brain say the same thing. Merge them into one: keep every distinct detail, drop repetition, and if they disagree keep the newest (they're listed newest first). Use only what they say: never add facts, reasons or guesses of your own. Plain words.

${[...group].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((m) => `- (${m.kind}, ${m.updatedAt.slice(0, 10)}) ${m.title}: ${m.text}`).join("\n")}

Reply with ONLY JSON: {"title":"…","text":"…","kind":"decision|fact|howto|work|person|project"}`;
  const r = await runClaudeOnce({ prompt, args: ["--model", "haiku", "--tools", "", "--no-session-persistence"], cwd: os.tmpdir(), timeoutMs: 90_000 });
  if (!r.ok) return null;
  try {
    const j = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] ?? "") as { title?: string; text?: string; kind?: MemoryKind };
    if (!j.title || !j.text) return null;
    return { title: j.title, text: j.text, kind: j.kind && KINDS.includes(j.kind) ? j.kind : group[0].kind };
  } catch {
    return null;
  }
}
