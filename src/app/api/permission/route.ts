import { type Decision, settle } from "@/lib/permissions";

export const dynamic = "force-dynamic";

const DECISIONS = new Set<Decision>(["allow", "always", "deny"]);

// Your answer to a permission question from a running Claude.
export async function POST(req: Request) {
  const { id, decision } = (await req.json()) as { id?: string; decision?: Decision };
  if (!id || !decision || !DECISIONS.has(decision)) return Response.json({ error: "bad request" }, { status: 400 });
  if (!settle(id, decision)) return Response.json({ error: "That question is no longer waiting (it timed out or the run ended)." }, { status: 410 });
  return Response.json({ ok: true });
}
