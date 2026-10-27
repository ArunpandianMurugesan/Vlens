import { randomUUID } from "node:crypto";
import { streamClaude } from "@/lib/runClaude";
import { resolveDir } from "@/lib/folders";
import { parseImages } from "@/lib/images";
import { isModel, modelArgs } from "@/lib/models";
import { getSession } from "@/lib/sessions";
import { getSettings } from "@/lib/settings";
import type { ChatMessage } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "plan" = read-only, "acceptEdits" = may edit files. Bash and other tools follow
// the project's own permission settings, since there's no one to answer a prompt.
const MODES = new Set(["plan", "acceptEdits"]);

interface Body {
  sessionId?: string; // continue this session...
  cwd?: string; // ...or start a new one in this folder
  prompt: string;
  mode: string;
  model?: string; // per-message pick; falls back to the default in Settings
  images?: unknown;
}

// Continues a root CLI session, or starts a new one in a folder. `--resume`
// appends to the same session file, so the session view picks up the new turn
// on its next refresh. A new session sends its id in the "session" event.
export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const parsed = parseImages(body.images);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const { images } = parsed;
  if (!body.prompt?.trim() && !images.length) return Response.json({ error: "prompt required" }, { status: 400 });
  if (!MODES.has(body.mode)) return Response.json({ error: "bad mode" }, { status: 400 });
  if (body.model !== undefined && !isModel(body.model)) return Response.json({ error: "bad model" }, { status: 400 });
  const model = modelArgs(body.model ?? (await getSettings()).defaultModel);

  if (!body.sessionId) {
    const cwd = await resolveDir(body.cwd ?? "");
    if (!cwd) return Response.json({ error: "That folder doesn't exist" }, { status: 400 });
    return streamClaude({
      prompt: body.prompt,
      images,
      args: ["--permission-mode", body.mode, ...model],
      cwd,
      signal: req.signal,
      sessionId: null,
      onFinish: async (blocks) => ({
        id: randomUUID(),
        parentId: null,
        role: "assistant",
        blocks,
        timestamp: new Date().toISOString(),
      }),
    });
  }

  const session = await getSession(body.sessionId);
  if (!session) return Response.json({ error: "session not found" }, { status: 404 });

  return streamClaude({
    prompt: body.prompt,
    images,
    args: ["--resume", session.id, "--permission-mode", body.mode, ...model],
    cwd: session.cwd,
    signal: req.signal,
    sessionId: session.id,
    onFinish: async (blocks) =>
      ({
        id: randomUUID(),
        parentId: session.messages.at(-1)?.id ?? null,
        role: "assistant",
        blocks,
        timestamp: new Date().toISOString(),
      }) satisfies ChatMessage,
  });
}
