import { macNotify } from "@/lib/macNotify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Posts a macOS notification for the Vlens app (see lib/macNotify.ts).
export async function POST(req: Request) {
  if (process.platform !== "darwin") return Response.json({ error: "macOS only" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { title?: unknown; body?: unknown };
  return (await macNotify(String(b.title ?? "Vlens"), String(b.body ?? "")))
    ? Response.json({ ok: true })
    : Response.json({ error: "Couldn't post the notification" }, { status: 500 });
}
