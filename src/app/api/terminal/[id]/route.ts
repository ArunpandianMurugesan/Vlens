import { closeTerminal } from "@/lib/terminals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Ends the shell (the panel's restart button).
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  closeTerminal(id);
  return Response.json({ ok: true });
}
