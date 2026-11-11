import { listAsks } from "@/lib/permissions";
import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// What the Mac menu bar shows (desktop/main.cjs): your plan usage, what waits on
// you (Vlens's own prompts you can answer from there, sessions elsewhere that need
// you), and what's working.
export async function GET() {
  const [sessions, limits] = await Promise.all([(await getProvider()).listSessions(), (await getProvider()).getLimits()]);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const where = (s: (typeof sessions)[number]) => (s.active?.entrypoint === "desktop" ? "Desktop app" : s.active?.byLens ? "Vlens" : "Terminal");
  const asks = listAsks().map((a) => {
    const s = a.sessionId ? byId.get(a.sessionId) : undefined;
    return { id: a.id, kind: a.kind, tool: a.tool, summary: a.summary, always: a.always, title: s?.title ?? "A session", where: s ? where(s) : "Vlens", session: a.sessionId ?? null };
  });
  const asked = new Set(asks.map((a) => a.session).filter(Boolean));
  const people = sessions.filter((s) => s.active);
  const w = limits.windows;
  return Response.json({
    usage: w ? { fiveHour: w.fiveHour ? Math.round(w.fiveHour.utilization * 100) : null, week: w.sevenDay ? Math.round(w.sevenDay.utilization * 100) : null } : null,
    asks,
    // Needs you, but only where it runs (a terminal's own prompt).
    waiting: people.filter((s) => s.active!.waitingFor && !asked.has(s.id)).map((s) => ({ id: s.id, title: s.title, why: s.active!.waitingFor, where: where(s) })),
    working: people.filter((s) => s.active!.status === "busy" && !s.active!.waitingFor).map((s) => ({ id: s.id, title: s.title, where: where(s) })),
  });
}
