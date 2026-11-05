import { ensureIssue, isIssueKey, listIssues } from "@/lib/botIssues";
import { runIssue, threadState } from "@/lib/botThreads";
import { getBot } from "@/lib/bots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// The bot's issue cards: each note, with what its thread is doing now.
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await getBot(id))) return Response.json({ error: "Bot not found." }, { status: 404 });
  const issues = await listIssues(id);
  return Response.json({ issues: issues.map(({ body: _body, ...i }) => (void _body, { ...i, live: threadState(id, i.key) })) });
}

// A new card, optionally started with a first message.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await getBot(id))) return Response.json({ error: "Bot not found." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { key?: string; title?: string; prompt?: string };
  if (!isIssueKey(body.key)) return Response.json({ error: "Use a key like XPAN-123 or PR-2068." }, { status: 400 });
  const issue = await ensureIssue(id, body.key, body.title ?? "");
  if (body.prompt?.trim()) {
    const r = runIssue(id, issue.key, body.prompt.trim());
    if (!r.ok) return Response.json({ error: r.error }, { status: 409 });
  }
  return Response.json({ ok: true, key: issue.key });
}
