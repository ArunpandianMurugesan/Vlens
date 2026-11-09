import { getIssue } from "@/lib/botIssues";
import { runIssue, stopIssue, threadState } from "@/lib/botThreads";
import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; key: string }> };

// One card opened: its note, its thread's recent messages, and what it's doing now.
export async function GET(_req: Request, { params }: Ctx) {
  const { id, key } = await params;
  const issue = await getIssue(id, decodeURIComponent(key));
  if (!issue) return Response.json({ error: "No such issue." }, { status: 404 });
  const session = issue.thread ? await (await getProvider()).getSession(issue.thread).catch(() => null) : null;
  const messages = (session?.messages ?? [])
    .filter((m) => m.role !== "sub-agent")
    .map((m) => ({
      id: m.id,
      role: m.role,
      text: m.blocks.flatMap((b) => (b.kind === "text" ? [b.text] : [])).join("\n\n"),
      tools: m.blocks.flatMap((b) => (b.kind === "tool_use" ? [b.name] : [])),
    }))
    .filter((m) => m.text || m.tools.length)
    .slice(-30);
  return Response.json({ issue, messages, live: threadState(id, issue.key) });
}

// A message in the card's thread; the reply runs in the background.
export async function POST(req: Request, { params }: Ctx) {
  const { id, key } = await params;
  const issue = await getIssue(id, decodeURIComponent(key));
  if (!issue) return Response.json({ error: "No such issue." }, { status: 404 });
  const { prompt } = (await req.json().catch(() => ({}))) as { prompt?: string };
  if (!prompt?.trim()) return Response.json({ error: "Say something first." }, { status: 400 });
  const r = runIssue(id, issue.key, prompt.trim());
  return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: 409 });
}

// Stop what its thread is doing.
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, key } = await params;
  stopIssue(id, decodeURIComponent(key));
  return Response.json({ ok: true });
}
