import { listNotifications, markRead } from "@/lib/botNotifications";
import { startBots } from "@/lib/botEngine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The bell: what your bots want you to know, newest first.
export async function GET() {
  startBots();
  const all = await listNotifications();
  return Response.json({ notifications: all.slice(0, 100), unread: all.filter((n) => !n.read).length });
}

// { ids } or { all: true, bot? }: mark read.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { ids?: string[]; all?: boolean; bot?: string };
  await markRead(b.all ? "all" : (b.ids ?? []).map(String), b.bot);
  return Response.json({ ok: true });
}
