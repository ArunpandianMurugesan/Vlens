import { prDiscussion } from "@/lib/prDiscussion";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET ?url=<pr>: the PR's review threads and conversation, from GitHub.
export async function GET(req: Request) {
  try {
    return Response.json(await prDiscussion(new URL(req.url).searchParams.get("url") ?? ""));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
