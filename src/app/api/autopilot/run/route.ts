import { setFailed } from "@/lib/autopilot";
import { check, ensureRunner, stopRun } from "@/lib/autopilotRunner";
import { isPrUrl } from "@/lib/reviewRecords";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST { action }: "run" looks for the next PR now (even when autopilot is off),
// "stop" ends a running review (that PR's, given a url; else all), "retry" clears a
// failed PR and looks again.
export async function POST(req: Request) {
  ensureRunner();
  const b = (await req.json().catch(() => ({}))) as { action?: string; url?: string };
  if (b.action === "stop") return Response.json({ ok: stopRun(isPrUrl(String(b.url ?? "")) ? String(b.url) : undefined), message: "Stopping the review." });
  if (b.action === "retry") {
    if (!isPrUrl(String(b.url ?? ""))) return Response.json({ error: "Which PR?" }, { status: 400 });
    await setFailed(String(b.url), null);
  }
  if (b.action === "run" || b.action === "retry") return Response.json({ ok: true, message: await check(true) });
  return Response.json({ error: "Expected run, stop or retry." }, { status: 400 });
}
