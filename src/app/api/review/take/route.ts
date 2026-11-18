import { latestTake } from "@/lib/prDiscussion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET ?url=<pr>: Claude's latest review of this PR (from its session), or null.
export async function GET(req: Request) {
  try {
    return Response.json({ take: await latestTake(new URL(req.url).searchParams.get("url") ?? "") });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
