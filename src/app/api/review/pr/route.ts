import { prDetail } from "@/lib/github";

export const dynamic = "force-dynamic";

// Details for one PR: description, files, reviews, checks.
export async function GET(req: Request) {
  try {
    return Response.json(await prDetail(new URL(req.url).searchParams.get("url") ?? ""));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
