import { parseImages } from "@/lib/images";
import { getProvider } from "@/lib/providers";
import { userContent } from "@/lib/runClaude";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A message you send while Claude is working in this session: it goes to the
// running Claude now and is read at its next step, instead of waiting for the
// whole reply to end. 409 when Claude isn't working (send it as a new message).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { prompt?: string; images?: unknown };
  const parsed = parseImages(body.images);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  if (!body.prompt?.trim() && !parsed.images.length) return Response.json({ error: "prompt required" }, { status: 400 });
  return (await getProvider()).steer(id, userContent(body.prompt ?? "", parsed.images))
    ? Response.json({ ok: true })
    : Response.json({ error: "Claude isn't working in this session right now." }, { status: 409 });
}
