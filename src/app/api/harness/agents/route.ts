import { listHarnessAgents } from "@/lib/harnessBridge";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The dev-agent-harness agents you can import as a Vlens bot (read only).
//   GET ?fresh=1 -> { agents: [{ name, description, shared }] }
export async function GET(req: Request) {
  try {
    return Response.json({ agents: await listHarnessAgents(new URL(req.url).searchParams.has("fresh")) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
