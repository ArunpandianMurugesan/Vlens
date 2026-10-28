import { activeSessions } from "@/lib/active";
import { getSession } from "@/lib/sessions";
import { getSettings } from "@/lib/settings";
import { openInTerminal } from "@/lib/terminal";

export const dynamic = "force-dynamic";

// Hand a session to the terminal: opens Terminal/iTerm running `claude --resume`.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return Response.json({ error: "not found" }, { status: 404 });
  const run = (await activeSessions()).get(id);
  if (run && !run.byLens) return Response.json({ error: "It's already open somewhere else." }, { status: 409 });
  if (run?.byLens) return Response.json({ error: "Wait for Vlens's reply to finish first." }, { status: 409 });
  try {
    await openInTerminal(session.cwd ?? process.env.HOME ?? "/", ["claude", "--resume", id], (await getSettings()).terminalApp);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
