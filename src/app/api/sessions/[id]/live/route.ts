import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Stops what Claude is doing on its own in this session (after a background
// task reported back). Its process, and any other background work, keep going.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (await (await getProvider()).interrupt(id)) ? Response.json({ ok: true }) : Response.json({ error: "Nothing to stop." }, { status: 409 });
}

// Closes Vlens's open Claude for this session, so a terminal can take it over.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (await (await getProvider()).release(id)) === "busy"
    ? Response.json({ error: "Claude is still working in this session. Wait for it to finish (or stop it) first." }, { status: 409 })
    : Response.json({ ok: true });
}
