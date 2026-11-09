import { applyBotFile, checkBotFile, draftBotFile } from "@/lib/botFileOps";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A new bot from a file (bot.md, lib/botFile.ts): draft it with Claude from your own
// words, check it, then create it.
//   POST { action: "draft", instruction } -> { text }
//   POST { action: "check", text }        -> what it would set up, its check commands tried once
//   POST { action: "apply", text }        -> the new bot
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; text?: string; instruction?: string };
  try {
    if (body.action === "draft") {
      if (!body.instruction?.trim()) return Response.json({ error: "Describe what it should do." }, { status: 400 });
      return Response.json({ text: await draftBotFile({ instruction: body.instruction, current: body.text }) });
    }
    if (typeof body.text !== "string") return Response.json({ error: "text required" }, { status: 400 });
    if (body.action === "apply") return Response.json(await applyBotFile(body.text, null));
    return Response.json(await checkBotFile(body.text, null));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
