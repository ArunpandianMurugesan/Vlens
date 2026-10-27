import { compactSession, handoffNote } from "@/lib/context";

export const dynamic = "force-dynamic";

// { action: "compact" } runs /compact; { action: "handoff" } returns a note to start a fresh session from.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action } = (await req.json()) as { action?: string };
  try {
    if (action === "compact") {
      await compactSession(id);
      return Response.json({ ok: true });
    }
    if (action === "handoff") return Response.json(await handoffNote(id));
    return Response.json({ error: "bad action" }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 409 });
  }
}
