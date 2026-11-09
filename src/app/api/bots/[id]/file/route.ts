import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeBotFile } from "@/lib/botFile";
import { applyBotFile, checkBotFile, draftBotFile } from "@/lib/botFileOps";
import { getBot } from "@/lib/bots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// A bot's file (bot.md, lib/botFile.ts).
//   GET                                   -> { text }
//   POST { action: "check", text }        -> what it would change, its check commands tried once
//   POST { action: "apply", text }        -> the bot, changed (your click on its Configuration page)
//   POST { action: "draft", instruction } -> a new text, written by Claude from the current one
export async function GET(_req: Request, { params }: Ctx) {
  const b = await getBot((await params).id);
  if (!b) return Response.json({ error: "Bot not found." }, { status: 404 });
  const text = await fs.readFile(path.join(b.dir, "bot.md"), "utf8").catch(() => writeBotFile(b, os.homedir()));
  return Response.json({ text });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string; text?: string; instruction?: string };
  try {
    if (body.action === "draft") {
      const b = await getBot(id);
      if (!b) return Response.json({ error: "Bot not found." }, { status: 404 });
      if (!body.instruction?.trim()) return Response.json({ error: "Say what should change." }, { status: 400 });
      const current = body.text ?? (await fs.readFile(path.join(b.dir, "bot.md"), "utf8").catch(() => writeBotFile(b, os.homedir())));
      return Response.json({ text: await draftBotFile({ instruction: body.instruction, current }) });
    }
    if (typeof body.text !== "string") return Response.json({ error: "text required" }, { status: 400 });
    if (body.action === "apply") return Response.json(await applyBotFile(body.text, id));
    return Response.json(await checkBotFile(body.text, id));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
