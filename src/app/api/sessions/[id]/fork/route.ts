import { forkSession } from "@anthropic-ai/claude-agent-sdk";
import { markRecent } from "@/lib/recent";
import { getSession } from "@/lib/sessions";
import { getSettings } from "@/lib/settings";
import { openInTerminal } from "@/lib/terminal";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Fork a session, like vTower and `claude --resume <id> --fork-session`: its whole
// history is copied into a new session in the same folder, and the original is
// left alone (so it can keep running, even in a terminal). No model call.
//   {}                  -> the copy, named "<title> ↳", to open in Vlens
//   { terminal: true }  -> a Terminal window running claude --resume <id> --fork-session
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { terminal } = (await req.json().catch(() => ({}))) as { terminal?: boolean };
  const session = await getSession(id);
  if (!session) return Response.json({ error: "Session not found." }, { status: 404 });
  if (!session.messages.length) return Response.json({ error: "Nothing to fork yet: it has no messages." }, { status: 400 });
  const cwd = session.cwd ?? process.env.HOME ?? "/";
  try {
    if (terminal) {
      await openInTerminal(cwd, ["claude", "--resume", id, "--fork-session"], (await getSettings()).terminalApp);
      return Response.json({ ok: true, terminal: true });
    }
    const title = `${session.title.replace(/\s*↳+$/, "")} ↳`.slice(0, 200);
    const { sessionId } = await forkSession(id, { title });
    await markRecent(sessionId); // stays in the sidebar's Sessions after you look away
    return Response.json({ ok: true, id: sessionId, title });
  } catch (e) {
    return Response.json({ error: (e as Error).message || "Couldn't fork it." }, { status: 500 });
  }
}
