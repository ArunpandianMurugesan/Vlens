import { applyBotFile, botFilesOf, checkBotFile, draftBotFile, filesFrom } from "@/lib/botFileOps";
import { getBot } from "@/lib/bots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// A bot's files (agent.yaml + PLAYBOOK.md, lib/botFile.ts).
//   GET                                                   -> { agent, playbook }
//   POST { action: "check", agent, playbook }             -> what it would change, its check commands tried once
//   POST { action: "apply", agent, playbook }             -> the bot, changed (your click on its Configuration page)
//   POST { action: "draft", instruction, agent?, playbook? } -> new files, written by Claude from the current ones
export async function GET(_req: Request, { params }: Ctx) {
  const b = await getBot((await params).id);
  if (!b) return Response.json({ error: "Bot not found." }, { status: 404 });
  return Response.json(await botFilesOf(b));
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; text?: string; agent?: string; playbook?: string; instruction?: string };
  try {
    const b = await getBot(id);
    if (!b) return Response.json({ error: "Bot not found." }, { status: 404 });
    if (body.action === "draft") {
      if (!body.instruction?.trim()) return Response.json({ error: "Say what should change." }, { status: 400 });
      return Response.json(await draftBotFile({ instruction: body.instruction, current: filesFrom(body) ?? (await botFilesOf(b)) }));
    }
    const files = filesFrom(body);
    if (!files) return Response.json({ error: "agent and playbook required" }, { status: 400 });
    if (body.action === "apply") return Response.json(await applyBotFile(files, id));
    return Response.json(await checkBotFile(files, id));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
