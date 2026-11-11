import { callTool, NotSignedIn } from "@/lib/harness/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The Harness page's harness tools, through Vlens's own sign-in. Only these: the
// page reads runs and agents, and acts only when you press a button (start a run,
// cancel one, archive your agent, pause your own runs).
const TOOLS = new Set([
  "list_runs",
  "get_run",
  "run_events",
  "run_transcript",
  "run_summary",
  "list_agents",
  "get_agent",
  "get_agent_health",
  "lookup_team",
  "submit_run",
  "cancel_run",
  "upsert_agent",
  "archive_agent",
  "pause_credential",
]);

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { tool?: string; args?: Record<string, unknown> };
  const tool = String(b.tool ?? "");
  if (!TOOLS.has(tool)) return Response.json({ error: `${tool} isn't a tool the Harness page uses.` }, { status: 400 });
  if (process.env.NODE_ENV === "development") console.log(`  harness ${tool}`); // which tool, never its arguments
  try {
    return Response.json({ result: await callTool(tool, b.args && typeof b.args === "object" ? b.args : {}) });
  } catch (e) {
    if (e instanceof NotSignedIn) return Response.json({ error: e.message, signedOut: true }, { status: 401 });
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
