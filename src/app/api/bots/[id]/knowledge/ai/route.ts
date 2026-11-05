import { writeKnowledgeWithAi } from "@/lib/botRuns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// { brief }: what it should know (a description, pasted notes, things to look up).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { brief } = (await req.json().catch(() => ({}))) as { brief?: string };
  if (!brief?.trim()) return Response.json({ error: "Say what it should know first." }, { status: 400 });
  try {
    return Response.json(await writeKnowledgeWithAi((await params).id, brief));
  } catch (e) {
    return Response.json({ ok: false, summary: (e as Error).message, added: 0 }, { status: 400 });
  }
}
