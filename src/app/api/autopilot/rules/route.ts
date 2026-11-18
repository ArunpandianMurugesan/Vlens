import { saveRules } from "@/lib/autopilot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PUT the whole rules object; bad values fall back to defaults (normalizeRules).
export async function PUT(req: Request) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Expected the rules as JSON." }, { status: 400 });
  return Response.json({ rules: await saveRules(body) });
}
