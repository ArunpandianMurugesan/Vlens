import { describe, trail } from "@/lib/brain/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// One thing's page: its story (memories, oldest first), relations, and what's nearby.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const t = await trail(decodeURIComponent((await params).id));
  if (!t) return Response.json({ error: "Not found." }, { status: 404 });
  const memories = await Promise.all(t.memories.map(async (m) => ({ ...m, ...(await describe(m)) })));
  return Response.json({ ...t, memories });
}
