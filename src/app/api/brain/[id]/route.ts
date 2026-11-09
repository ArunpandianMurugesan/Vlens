import { forgetMemory, getMemory, type MemoryKind, restoreMemory, updateMemory } from "@/lib/brain/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// One memory, from the Brain page: read, fix, pin, forget, or bring back.
export async function GET(_req: Request, { params }: Ctx) {
  const m = await getMemory((await params).id);
  return m ? Response.json(m) : Response.json({ error: "Not found." }, { status: 404 });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const b = (await req.json().catch(() => ({}))) as { title?: string; text?: string; kind?: MemoryKind; importance?: number; tags?: string[]; pinned?: boolean; restore?: boolean };
  const { id } = await params;
  try {
    if (b.restore) return Response.json(await restoreMemory(id));
    return Response.json(await updateMemory(id, { ...b, by: "you", source: { type: "you" } }));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await forgetMemory((await params).id, "you");
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
