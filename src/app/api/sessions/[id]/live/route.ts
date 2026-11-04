import { interruptLive } from "@/lib/liveSessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Stops what Claude is doing on its own in this session (after a background
// task reported back). Its process, and any other background work, keep going.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (await interruptLive(id)) ? Response.json({ ok: true }) : Response.json({ error: "Nothing to stop." }, { status: 409 });
}
