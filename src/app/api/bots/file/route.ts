import { applyBotFile, checkBotFile, draftBotFile, filesFrom } from "@/lib/botFileOps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A new bot from its files (agent.yaml + PLAYBOOK.md, lib/botFile.ts): draft them
// with Claude from your own words, check them, then create it.
//   POST { action: "draft", instruction, agent?, playbook? } -> { agent, playbook }
//   POST { action: "check", agent, playbook }                -> what it would set up, its check commands tried once
//   POST { action: "apply", agent, playbook }                -> the new bot
// (an older client may send { text } with a single bot.md instead)
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; text?: string; agent?: string; playbook?: string; instruction?: string };
  try {
    const files = filesFrom(body);
    if (body.action === "draft") {
      if (!body.instruction?.trim()) return Response.json({ error: "Describe what it should do." }, { status: 400 });
      return Response.json(await draftBotFile({ instruction: body.instruction, current: files ?? undefined }));
    }
    if (!files) return Response.json({ error: "agent and playbook required" }, { status: 400 });
    if (body.action === "apply") return Response.json(await applyBotFile(files, null));
    return Response.json(await checkBotFile(files, null));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
