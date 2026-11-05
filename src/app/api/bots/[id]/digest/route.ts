import { digestBot } from "@/lib/botDigest";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Learns what's new from the bot's sources (can take a few minutes).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json(await digestBot((await params).id));
  } catch (e) {
    return Response.json({ ok: false, summary: (e as Error).message }, { status: 400 });
  }
}
