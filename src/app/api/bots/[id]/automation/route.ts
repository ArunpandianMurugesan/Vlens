import { commitBot, getBot } from "@/lib/bots";
import { readSpec, readSpecFiles, writeSpecFiles } from "@/lib/botSpec";
import { writeAutomationWithAi } from "@/lib/botRuns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// Its bot.yaml and values.yaml, as text, and what Vlens reads from them.
export async function GET(_req: Request, { params }: Ctx) {
  const b = await getBot((await params).id);
  if (!b) return Response.json({ error: "Bot not found." }, { status: 404 });
  const [files, spec] = await Promise.all([readSpecFiles(b.dir), readSpec(b.dir)]);
  return Response.json({ files, spec });
}

// { bot?, values? }: saved only if they read back as a valid spec.
export async function PUT(req: Request, { params }: Ctx) {
  const b = await getBot((await params).id);
  if (!b) return Response.json({ error: "Bot not found." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { bot?: string; values?: string };
  try {
    const spec = await writeSpecFiles(b.dir, { bot: body.bot?.slice(0, 100_000), values: body.values?.slice(0, 50_000) });
    await commitBot(b.id, "Edit bot.yaml / values.yaml");
    return Response.json({ spec, files: await readSpecFiles(b.dir) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

// { brief }: Claude writes the automation from a description.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { brief } = (await req.json().catch(() => ({}))) as { brief?: string };
  if (!brief?.trim()) return Response.json({ error: "Say what it should watch and do first." }, { status: 400 });
  try {
    return Response.json(await writeAutomationWithAi(id, brief));
  } catch (e) {
    return Response.json({ ok: false, summary: (e as Error).message }, { status: 400 });
  }
}
