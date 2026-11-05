import { listIssues } from "@/lib/botIssues";
import { threadState } from "@/lib/botThreads";
import { readWatchState } from "@/lib/botWatch";
import { createBot, listBots, stylePresets, triggersOf } from "@/lib/bots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Each bot, with what its card on the Bots page shows: its cards, what's working,
// what waits on you, and when a trigger last checked.
export async function GET() {
  const bots = await listBots();
  const withStats = await Promise.all(
    bots.map(async (b) => {
      const [issues, watch] = await Promise.all([listIssues(b.id).catch(() => []), readWatchState(b.id).catch(() => ({}))]);
      let running = 0;
      let waiting = 0;
      let ready = 0;
      for (const i of issues) {
        const s = threadState(b.id, i.key);
        if (s.running) running++;
        waiting += s.asks.length;
        if (!s.running && /ready|draft/i.test(i.status)) ready++;
      }
      const on = triggersOf(b).filter((t) => t.on);
      const runs = Object.values(watch).map((s) => s.lastRun ?? "").filter(Boolean).sort();
      return {
        ...b,
        stats: {
          cards: issues.length,
          running,
          waiting,
          ready,
          triggersOn: on.length,
          every: on.length ? Math.min(...on.map((t) => (t.kind === "session" ? 1 : t.everyMinutes))) : null,
          lastCheck: runs.at(-1) ?? null,
          lastCard: issues.map((i) => i.updated).sort().at(-1) ?? null,
        },
      };
    }),
  );
  return Response.json({ bots: withStats, stylePresets: stylePresets() });
}

// { name } -> the new bot
export async function POST(req: Request) {
  const { name } = (await req.json().catch(() => ({}))) as { name?: string };
  return Response.json(await createBot(String(name ?? "")));
}
