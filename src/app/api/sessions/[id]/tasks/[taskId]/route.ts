import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Stops one background agent or command in the session's open Claude.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const { id, taskId } = await params;
  return (await (await getProvider()).stopTask(id, taskId)) ? Response.json({ ok: true }) : Response.json({ error: "Couldn't stop it (it may have just finished)." }, { status: 409 });
}
