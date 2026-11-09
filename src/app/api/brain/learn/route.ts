import { brainActivity, brainSettings, learnScope, learnStatus, learnTick, updateBrainSettings } from "@/lib/brain/learn";
import { lastReflection, reflect } from "@/lib/brain/reflect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// How the brain learns (the Brain page).
//   GET                          -> settings, status, and what it learned lately
//   PATCH { paused?, skip?, maxRunsPerDay? }   (what it learns from is set in each bot's bot.md)
//   POST { action: "learn" }     -> look at your sessions now (no waiting for a batch)
//   POST { action: "reflect" }   -> tidy up now
export async function GET() {
  const [settings, status, activity, reflected, scope] = await Promise.all([brainSettings(), learnStatus(), brainActivity(), lastReflection(), learnScope()]);
  return Response.json({ settings, scope, status: { ...status, lastReflection: reflected }, activity: activity.slice(0, 60) });
}

export async function PATCH(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return Response.json({ settings: await updateBrainSettings(b) });
}

export async function POST(req: Request) {
  const { action } = (await req.json().catch(() => ({}))) as { action?: string };
  try {
    if (action === "learn") {
      await learnTick({ now: true });
      return Response.json({ ok: true, status: await learnStatus() });
    }
    if (action === "reflect") return Response.json(await reflect());
    return Response.json({ error: "Unknown action." }, { status: 400 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
