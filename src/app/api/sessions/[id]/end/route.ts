import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

// Stops the Claude process (terminal or desktop app) that has this session open.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await (await getProvider()).endSession(id);
  return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: 409 });
}
