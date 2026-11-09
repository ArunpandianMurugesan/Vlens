import { addMemory, KINDS, listForgotten, listMemories, type MemoryKind, searchMemories } from "@/lib/brain/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The Brain page (same-origin only, see middleware.ts). Bots don't use this: they
// reach the brain in-process, through their brain tools (lib/botAgent.ts).
//   GET ?q=…&kind=…   search by meaning (no q: all, newest first)
//   GET ?forgotten=1  what was forgotten, to bring back
//   POST { title, text, kind?, importance?, tags? }   add one yourself
export async function GET(req: Request) {
  const u = new URL(req.url);
  try {
    if (u.searchParams.get("forgotten")) return Response.json({ memories: await listForgotten() });
    const q = u.searchParams.get("q") ?? "";
    const kind = u.searchParams.get("kind") as MemoryKind | null;
    if (q.trim()) return Response.json({ memories: await searchMemories(q, { limit: 30, kind: kind && KINDS.includes(kind) ? kind : undefined }) });
    const all = await listMemories();
    return Response.json({ memories: kind ? all.filter((m) => m.kind === kind) : all });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { title?: string; text?: string; kind?: MemoryKind; importance?: number; tags?: string[] };
  try {
    return Response.json(await addMemory({ title: b.title ?? "", text: b.text ?? "", kind: b.kind, importance: b.importance, tags: b.tags, source: { type: "you" } }));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
