import { runRetro } from "@/lib/coach";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Claude reviews one session: what went well, what cost time, lessons to keep.
export async function POST(req: Request) {
  const { sessionId } = (await req.json()) as { sessionId?: string };
  if (!sessionId || !/^[0-9a-f-]{36}$/.test(sessionId)) return Response.json({ error: "bad session id" }, { status: 400 });
  if (!(await getSettings()).retro) return Response.json({ error: "Retros are off in Settings → Coach." }, { status: 403 });
  try {
    return Response.json(await runRetro(sessionId));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
