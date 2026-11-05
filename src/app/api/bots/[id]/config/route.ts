import { cleanPatch, configYaml, parseConfigYaml } from "@/lib/botConfig";
import { getBot, updateBot } from "@/lib/bots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// "View as file": its configuration as YAML.
export async function GET(_req: Request, { params }: Ctx) {
  const b = await getBot((await params).id);
  return b ? Response.json({ yaml: configYaml(b) }) : Response.json({ error: "Bot not found." }, { status: 404 });
}

// Your hand edit, checked like the Settings page.
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const { yaml } = (await req.json().catch(() => ({}))) as { yaml?: string };
  const parsed = parseConfigYaml(String(yaml ?? ""));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const c = cleanPatch(Object.fromEntries(Object.entries(parsed.body).filter(([, v]) => v !== undefined)));
  if ("error" in c) return Response.json({ error: c.error }, { status: 400 });
  try {
    const b = await updateBot(id, c.patch);
    return Response.json({ bot: b, yaml: configYaml(b) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
