import { getSession } from "@/lib/sessions";
import { threadsForSession } from "@/lib/threads";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ session, threads: await threadsForSession(id) });
}
