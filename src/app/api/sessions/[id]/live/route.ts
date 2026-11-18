import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Stop for this session: ends what Claude is doing in it, your reply or a turn
// of its own (after a background task reported back), and denies its open
// questions. A reply still waiting behind Claude's own turn is dropped instead,
// leaving that turn alone. Closing a reply's stream doesn't stop it, so the
// window calls this. Its process, and any other background work, keep going.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (await (await getProvider()).interrupt(id)) ? Response.json({ ok: true }) : Response.json({ error: "Nothing to stop." }, { status: 409 });
}

// Closes Vlens's open Claude for this session, so a terminal can take it over.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (await (await getProvider()).release(id)) === "busy"
    ? Response.json({ error: "Claude is still working in this session. Wait for it to finish (or stop it) first." }, { status: 409 })
    : Response.json({ ok: true });
}
