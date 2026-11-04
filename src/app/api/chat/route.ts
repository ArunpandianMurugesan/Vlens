import { randomUUID } from "node:crypto";
import { procFor } from "@/lib/liveSessions";
import { turnResponse, userContent } from "@/lib/runClaude";
import { activeSessions } from "@/lib/active";
import { resolveDir } from "@/lib/folders";
import { parseImages } from "@/lib/images";
import { isModel } from "@/lib/models";
import { markRecent } from "@/lib/recent";
import { getSession } from "@/lib/sessions";
import { lensPluginArgs } from "@/lib/lensPlugin";
import { isPermissionMode } from "@/lib/modes";
import { getSettings } from "@/lib/settings";
import type { ChatMessage } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


interface Body {
  sessionId?: string; // continue this session...
  cwd?: string; // ...or start a new one in this folder
  prompt: string;
  mode: string;
  model?: string; // per-message pick; falls back to the default in Settings
  images?: unknown;
}

// Continues a root CLI session, or starts a new one in a folder. The session's
// Claude stays open between replies (see liveSessions.ts); a new one starts
// with `--resume`, which appends to the same session file, so the session view
// picks up each turn on its next refresh. A new session sends its id in the
// "session" event.
export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const parsed = parseImages(body.images);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const { images } = parsed;
  if (!body.prompt?.trim() && !images.length) return Response.json({ error: "prompt required" }, { status: 400 });
  if (!isPermissionMode(body.mode)) return Response.json({ error: "bad mode" }, { status: 400 });
  if (body.model !== undefined && !isModel(body.model)) return Response.json({ error: "bad model" }, { status: 400 });
  const settings = await getSettings();
  const model = body.model ?? settings.defaultModel;
  const extra = await lensPluginArgs(settings);
  const content = userContent(body.prompt, images);

  if (!body.sessionId) {
    const cwd = await resolveDir(body.cwd ?? "");
    if (!cwd) return Response.json({ error: "That folder doesn't exist" }, { status: 400 });
    // Keep it on the sidebar after the reply, when its process has exited.
    const proc = await procFor({ sessionId: null, cwd, mode: body.mode, model, extra, onSession: (id) => void markRecent(id) });
    return turnResponse(proc, content, req.signal, async (blocks) => ({
      id: randomUUID(),
      parentId: null,
      role: "assistant",
      blocks,
      timestamp: new Date().toISOString(),
    }));
  }

  const session = await getSession(body.sessionId);
  if (!session) return Response.json({ error: "session not found" }, { status: 404 });
  // The claude running in a terminal (or the desktop app) holds this conversation
  // in memory and never re-reads the file, so a reply from here wouldn't reach
  // it and would fork the history. One place types at a time.
  const run = (await activeSessions()).get(session.id);
  if (run && !run.byLens)
    return Response.json(
      { error: `This session is open in ${run.entrypoint === "desktop" ? "the desktop app" : "a terminal"}. Type there, or take it over in Vlens.` },
      { status: 409 },
    );
  await markRecent(session.id);

  const proc = await procFor({ sessionId: session.id, cwd: session.cwd, mode: body.mode, model, extra });
  return turnResponse(proc, content, req.signal, async (blocks) =>
    ({
      id: randomUUID(),
      parentId: session.messages.at(-1)?.id ?? null,
      role: "assistant",
      blocks,
      timestamp: new Date().toISOString(),
    }) satisfies ChatMessage,
  );
}
