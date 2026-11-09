import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await (await getProvider()).getLimits());
}

// Refresh: runs a tiny Claude call to get current numbers. If an active session
// uses a model whose context window we don't know yet, probe with that model
// once so its context percentage is exact from then on.
export async function POST() {
  const unknown = (await (await getProvider()).listSessions()).find((s) => s.active && s.context?.estimated && s.context.model)?.context?.model;
  await (await getProvider()).probe(unknown ?? undefined);
  return Response.json(await (await getProvider()).getLimits());
}
