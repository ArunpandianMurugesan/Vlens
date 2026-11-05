import { mergePr } from "@/lib/github";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// { url, method } -> merges the PR (you confirmed it in Review).
export async function POST(req: Request) {
  const { url, method } = (await req.json().catch(() => ({}))) as { url?: string; method?: string };
  const m = method === "merge" || method === "rebase" ? method : "squash";
  try {
    return Response.json(await mergePr(String(url ?? ""), m));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
