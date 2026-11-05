import { tryBot } from "@/lib/botRuns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// { prompt } -> the bot's answer, as it is set up now (the builder's preview).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { prompt } = (await req.json().catch(() => ({}))) as { prompt?: string };
  if (!prompt?.trim()) return Response.json({ error: "prompt required" }, { status: 400 });
  try {
    return Response.json(await tryBot((await params).id, prompt.slice(0, 8000)));
  } catch (e) {
    return Response.json({ ok: false, text: (e as Error).message }, { status: 400 });
  }
}
