import { endSession } from "@/lib/active";

export const dynamic = "force-dynamic";

// Stops the Claude CLI process that has this session open.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await endSession(id);
  return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: 409 });
}
