import { getSettings } from "@/lib/settings";
import { openInTerminal } from "@/lib/terminal";
import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";

// Hand a session to the terminal: opens Terminal/iTerm running `claude --resume`.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await (await getProvider()).getSession(id);
  if (!session) return Response.json({ error: "not found" }, { status: 404 });
  const run = (await (await getProvider()).activeSessions()).get(id);
  if (run && !run.byLens) return Response.json({ error: "It's already open somewhere else." }, { status: 409 });
  // Vlens keeps the session's Claude open between replies; close it so only the terminal has it.
  if (run?.byLens && (await (await getProvider()).release(id)) !== "closed")
    return Response.json({ error: "Wait for Vlens's reply (and its background work) to finish first." }, { status: 409 });
  try {
    await openInTerminal(session.cwd ?? process.env.HOME ?? "/", (await getProvider()).resumeCommand(id), (await getSettings()).terminalApp);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
