import { lensPluginArgs } from "@/lib/lensPlugin";
import { isModel } from "@/lib/models";
import { isPermissionMode } from "@/lib/modes";
import { getProvider } from "@/lib/providers";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Reload: ends this session's Claude and starts a fresh `claude --resume` on the
// same conversation, so it picks up changed CLAUDE.md, settings, skills, hooks,
// MCP servers and plugins. Body: { mode, model? }, used when no Claude was open.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { mode?: string; model?: string };
  const provider = await getProvider();
  const session = await provider.getSession(id);
  if (!session) return Response.json({ error: "session not found" }, { status: 404 });
  // Same rule as sending a message: one place drives a session at a time.
  const run = (await provider.activeSessions()).get(id);
  if (run && !run.byLens)
    return Response.json(
      { error: `This session is open in ${run.entrypoint === "desktop" ? "the desktop app" : "a terminal"}. Reload it there, or take it over in Vlens first.` },
      { status: 409 },
    );
  const settings = await getSettings();
  const mode = body.mode && isPermissionMode(body.mode) ? body.mode : "default";
  const model = body.model !== undefined && isModel(body.model) ? body.model : settings.defaultModel;
  const r = await provider.reload({ sessionId: id, cwd: session.cwd, mode, model, extra: await lensPluginArgs(settings) });
  return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: r.busy ? 409 : 500 });
}
