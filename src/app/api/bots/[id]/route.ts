import { cleanPatch } from "@/lib/botConfig";
import { deleteBot, getBot, updateBot } from "@/lib/bots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const b = await getBot((await params).id);
  return b ? Response.json(b) : Response.json({ error: "Bot not found." }, { status: 404 });
}

// Any of the settings; the rest stay as they are.
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const c = cleanPatch((await req.json().catch(() => ({}))) as Record<string, unknown>);
  if ("error" in c) return Response.json({ error: c.error }, { status: 400 });
  try {
    return Response.json(await updateBot(id, c.patch));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await deleteBot((await params).id);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
