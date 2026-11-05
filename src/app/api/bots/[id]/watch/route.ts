import { getBot } from "@/lib/bots";
import { checkTrigger, readWatchState, testGate, testList } from "@/lib/botWatch";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Each trigger's last check: when, and what it found.
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await getBot(id))) return Response.json({ error: "Bot not found." }, { status: 404 });
  const all = await readWatchState(id);
  const out: Record<string, { lastRun: string | null; lastResult: string | null; lastError: string | null }> = {};
  for (const [k, s] of Object.entries(all)) out[k] = { lastRun: s.lastRun ?? null, lastResult: s.lastResult ?? null, lastError: s.lastError ?? null };
  return Response.json({ triggers: out });
}

// { trigger, action: "run" } = Run now; "list" and "gate" are the Test buttons (no AI).
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await getBot(id))) return Response.json({ error: "Bot not found." }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { trigger?: string; action?: string; item?: Record<string, string> };
  const trigger = String(b.trigger ?? "");
  if (b.action === "list") return Response.json(await testList(id, trigger));
  if (b.action === "gate") return Response.json(await testGate(id, trigger, b.item ?? {}));
  return Response.json(await checkTrigger(id, trigger));
}
