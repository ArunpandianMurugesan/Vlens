import { randomUUID } from "node:crypto";
import { turnResponse, userContent } from "@/lib/runClaude";
import { resolveDir } from "@/lib/folders";
import { parseImages } from "@/lib/images";
import { isModel } from "@/lib/models";
import { markRecent } from "@/lib/recent";
import { lensPluginArgs } from "@/lib/lensPlugin";
import { isPermissionMode } from "@/lib/modes";
import { getSettings } from "@/lib/settings";
import { worktreeArgs } from "@/lib/worktree";
import { setArchived } from "@/lib/archive";
import { BotRun } from "@/lib/botAgent";
import { issueByThread } from "@/lib/botIssues";
import { threadState } from "@/lib/botThreads";
import { botIdForCwd, getBot } from "@/lib/bots";
import type { ChatMessage } from "@/lib/types";
import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


interface Body {
  sessionId?: string; // continue this session...
  cwd?: string; // ...or start a new one in this folder
  prompt: string;
  mode: string;
  model?: string; // per-message pick; falls back to the default in Settings
  images?: unknown;
  worktree?: boolean; // a new session: work in its own git worktree
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
  const mode = body.mode;
  const extra = await lensPluginArgs(settings);
  // A chat with a bot (in its folder) runs with the Agent SDK instead, as the
  // bot: its model, mode, connectors and setup tools (botAgent.ts).
  const botFor = (cwd: string | null) => getBot(botIdForCwd(cwd) ?? "");
  const reply = (parentId: string | null) => async (blocks: ChatMessage["blocks"]) =>
    ({ id: randomUUID(), parentId, role: "assistant", blocks, timestamp: new Date().toISOString() }) satisfies ChatMessage;
  const content = userContent(body.prompt, images);

  if (!body.sessionId) {
    const cwd = await resolveDir(body.cwd ?? "");
    if (!cwd) return Response.json({ error: "That folder doesn't exist" }, { status: 400 });
    const bot = await botFor(cwd);
    if (bot) return turnResponse(new BotRun(bot, null, (id) => void markRecent(id)), content, req.signal, reply(null));
    let wt: string[] = [];
    if (body.worktree) {
      try {
        wt = await worktreeArgs(cwd);
      } catch (e) {
        return Response.json({ error: `Can't make a worktree here: ${(e as Error).message}` }, { status: 400 });
      }
    }
    // Keep it on the sidebar after the reply, when its process has exited.
    const proc = await (await getProvider()).openSession({ sessionId: null, cwd, mode, model, extra: [...extra, ...wt], onSession: (id) => void markRecent(id) });
    return turnResponse(proc, content, req.signal, reply(null));
  }

  const session = await (await getProvider()).getSession(body.sessionId);
  if (!session) return Response.json({ error: "session not found" }, { status: 404 });
  // The claude running in a terminal (or the desktop app) holds this conversation
  // in memory and never re-reads the file, so a reply from here wouldn't reach
  // it and would fork the history. One place types at a time.
  const run = (await (await getProvider()).activeSessions()).get(session.id);
  if (run && !run.byLens)
    return Response.json(
      { error: `This session is open in ${run.entrypoint === "desktop" ? "the desktop app" : "a terminal"}. Type there, or take it over in Vlens.` },
      { status: 409 },
    );
  await markRecent(session.id);
  await setArchived(session.id, false); // writing in an archived session brings it back

  const bot = await botFor(session.cwd);
  if (bot) {
    // An issue's thread, opened in full (Fork): it stays that issue's thread.
    const issue = await issueByThread(bot.id, session.id);
    if (issue && threadState(bot.id, issue.key).running)
      return Response.json({ error: `${issue.key} is still working on its card. Wait for it, or stop it there.` }, { status: 409 });
    return turnResponse(new BotRun(bot, session.id, undefined, issue ? { issue: issue.key } : {}), content, req.signal, reply(session.messages.at(-1)?.id ?? null));
  }
  const proc = await (await getProvider()).openSession({ sessionId: session.id, cwd: session.cwd, mode, model, extra });
  return turnResponse(proc, content, req.signal, reply(session.messages.at(-1)?.id ?? null));
}
