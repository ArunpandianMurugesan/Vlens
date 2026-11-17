import { isPrUrl, prSnapshot, recordRun, recordsFor } from "@/lib/reviewRecords";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET ?url=<pr>: this PR's review runs and posts, and where the PR is now
// (so the panel can say "the PR changed since this review").
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!isPrUrl(url)) return Response.json({ error: "Which PR?" }, { status: 400 });
  const record = await recordsFor(url);
  try {
    return Response.json({ record, current: await prSnapshot(url) });
  } catch (e) {
    return Response.json({ record, current: null, error: (e as Error).message });
  }
}

// POST { url, sessionId }: a review just started in that session. Notes which
// commit (and diff) it is looking at.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { url?: string; sessionId?: string };
  const url = String(b.url ?? "");
  const sessionId = String(b.sessionId ?? "");
  if (!isPrUrl(url) || !/^[0-9a-f-]{36}$/.test(sessionId)) return Response.json({ error: "Expected a PR link and a session id." }, { status: 400 });
  try {
    const snap = await prSnapshot(url, true);
    await recordRun(url, { sessionId, ...snap, at: new Date().toISOString() });
    return Response.json({ ok: true, ...snap });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
