import { readBotFiles } from "@/lib/botFile";
import { botFilesOf } from "@/lib/botFileOps";
import { getBot } from "@/lib/bots";
import { me } from "@/lib/github";
import { toHarness } from "@/lib/harnessMap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A bot as a dev-agent-harness agent: agent.yaml + PLAYBOOK.md to copy, and what
// doesn't carry over. Nothing is sent anywhere.
//   GET -> { agent, playbook, notes }
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const b = await getBot((await params).id);
  if (!b) return Response.json({ error: "Bot not found." }, { status: 404 });
  const { file } = readBotFiles(await botFilesOf(b));
  if (!file) return Response.json({ error: "Its files can't be read. Fix them first." }, { status: 400 });
  return Response.json(toHarness(file, { login: await me().catch(() => null) }));
}
