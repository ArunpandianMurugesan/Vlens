import { crashedSessions, dismiss, restore } from "@/lib/restore";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// Lists sessions that stopped unexpectedly. With auto-restore on, reopens them right away.
export async function GET() {
  const crashed = await crashedSessions();
  if (crashed.length && (await getSettings()).autoRestore) {
    const restored: string[] = [];
    for (const c of crashed) if (await restore(c.key).catch(() => false)) restored.push(c.title);
    return Response.json({ crashed: [], restored });
  }
  return Response.json({ crashed, restored: [] });
}

// { key, action: "restore" | "dismiss" }; key "all" applies to every crashed session.
export async function POST(req: Request) {
  const { key, action } = (await req.json()) as { key: string; action: "restore" | "dismiss" };
  if (action !== "restore" && action !== "dismiss") return Response.json({ error: "bad action" }, { status: 400 });
  const keys = key === "all" ? (await crashedSessions()).map((c) => c.key) : [key];
  try {
    for (const k of keys) await (action === "restore" ? restore(k) : dismiss(k));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
