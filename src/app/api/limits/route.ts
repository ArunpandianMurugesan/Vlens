import { getLimits, probe } from "@/lib/limits";
import { listSessions } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getLimits());
}

// Refresh: runs a tiny Claude call to get current numbers. If an active session
// uses a model whose context window we don't know yet, probe with that model
// once so its context percentage is exact from then on.
export async function POST() {
  const unknown = (await listSessions()).find((s) => s.active && s.context?.estimated && s.context.model)?.context?.model;
  await probe(unknown ?? undefined);
  return Response.json(await getLimits());
}
