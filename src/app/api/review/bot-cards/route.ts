import { listIssues } from "@/lib/botIssues";
import { threadState } from "@/lib/botThreads";
import { listBots } from "@/lib/bots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Your bots' cards about one PR (?url=…): a card keyed like "repo#123", or one that cites the PR's link.
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url") ?? "";
  const m = /^https:\/\/github\.com\/[\w.-]+\/([\w.-]+)\/pull\/(\d+)$/.exec(url);
  if (!m) return Response.json({ cards: [] });
  const key = `${m[1]}#${m[2]}`.toLowerCase();
  const cards = [];
  for (const b of await listBots()) {
    for (const i of await listIssues(b.id).catch(() => [])) {
      if (i.key.toLowerCase() !== key && !i.sources.some((s) => s.replace(/\/$/, "") === url)) continue;
      const s = threadState(b.id, i.key);
      cards.push({ bot: b.id, botName: b.name, avatar: b.avatar, key: i.key, status: s.asks.length ? "needs you" : s.running ? "working" : i.status, updated: i.updated, draft: /##\s*Draft review/i.test(i.body) });
    }
  }
  return Response.json({ cards });
}
