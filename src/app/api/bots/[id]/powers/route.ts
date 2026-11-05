import { getBot } from "@/lib/bots";
import { HOOK_EVENTS } from "@/lib/hooks";
import { catalog } from "@/lib/marketplace";
import { listMcp } from "@/lib/mcp";
import { listSkills } from "@/lib/skills";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// What it could have on (its Settings, Powers): your connectors, skills (yours and
// its own, from its folder) and installed plugins, plus the hook events.
export async function GET(_req: Request, { params }: Ctx) {
  const b = await getBot((await params).id);
  if (!b) return Response.json({ error: "Bot not found." }, { status: 404 });
  const [mcp, skills, cat] = await Promise.all([listMcp().catch(() => []), listSkills(b.dir).catch(() => []), catalog().catch(() => ({ plugins: [] }))]);
  const seen = new Set<string>();
  return Response.json({
    connectors: mcp.filter((m) => !seen.has(m.name) && seen.add(m.name)).map((m) => ({ name: m.name, status: m.status })),
    skills: skills.filter((s) => s.enabled).map((s) => ({ name: s.name, description: s.description.slice(0, 200), source: s.source })),
    plugins: cat.plugins.filter((p) => p.installs.length).map((p) => ({ id: p.id, name: p.name, description: p.description.slice(0, 200), enabled: p.installs.some((i) => i.enabled && (i.scope === "user" || i.project === b.dir)) })),
    hookEvents: HOOK_EVENTS,
  });
}
