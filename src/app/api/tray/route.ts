import { listBots } from "@/lib/bots";
import { listNotifications } from "@/lib/botNotifications";
import { getLimits } from "@/lib/limits";
import { listAsks } from "@/lib/permissions";
import { listSessions } from "@/lib/sessions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// What the Mac menu bar shows (desktop/main.cjs): your plan usage, what waits on
// you (Vlens's own prompts you can answer from there, sessions elsewhere that need
// you, bots with news), and what's working.
export async function GET() {
  const [sessions, limits, bots, notes] = await Promise.all([listSessions(), getLimits(), listBots(), listNotifications()]);
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const botName = new Map(bots.map((b) => [b.id, b.name]));
  const where = (s: (typeof sessions)[number]) => (s.active?.entrypoint === "desktop" ? "Desktop app" : s.active?.byLens ? "Vlens" : "Terminal");
  const asks = listAsks().map((a) => {
    const s = a.sessionId ? byId.get(a.sessionId) : undefined;
    const title = a.botId ? `${botName.get(a.botId) ?? "Bot"}${a.key ? ` · ${a.key}` : ""}` : (s?.title ?? "A session");
    return { id: a.id, kind: a.kind, tool: a.tool, summary: a.summary, always: a.always, title, where: a.botId ? "Bot" : s ? where(s) : "Vlens", session: a.botId ? null : (a.sessionId ?? null), bot: a.botId ?? null, key: a.key ?? null };
  });
  const asked = new Set(asks.map((a) => a.session).filter(Boolean));
  const people = sessions.filter((s) => !s.botId && s.active);
  const w = limits.windows;
  return Response.json({
    usage: w ? { fiveHour: w.fiveHour ? Math.round(w.fiveHour.utilization * 100) : null, week: w.sevenDay ? Math.round(w.sevenDay.utilization * 100) : null } : null,
    asks,
    // Needs you, but only where it runs (a terminal's own prompt).
    waiting: people.filter((s) => s.active!.waitingFor && !asked.has(s.id)).map((s) => ({ id: s.id, title: s.title, why: s.active!.waitingFor, where: where(s) })),
    working: people.filter((s) => s.active!.status === "busy" && !s.active!.waitingFor).map((s) => ({ id: s.id, title: s.title, where: where(s) })),
    bots: bots.map((b) => ({ id: b.id, name: b.name, unread: notes.filter((n) => n.bot === b.id && !n.read).length, news: notes.find((n) => n.bot === b.id && !n.read)?.title ?? null })),
  });
}
