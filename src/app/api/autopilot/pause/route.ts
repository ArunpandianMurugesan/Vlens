import { setPaused } from "@/lib/autopilot";
import { isPrUrl } from "@/lib/reviewRecords";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// { url, paused, title? }: keep autopilot away from one PR (or let it back).
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { url?: string; paused?: boolean; title?: string };
  const url = String(b.url ?? "");
  if (!isPrUrl(url) || typeof b.paused !== "boolean") return Response.json({ error: "Expected a PR link and paused: true or false." }, { status: 400 });
  await setPaused(url, typeof b.title === "string" ? b.title.slice(0, 200) : undefined, b.paused);
  return Response.json({ ok: true });
}
