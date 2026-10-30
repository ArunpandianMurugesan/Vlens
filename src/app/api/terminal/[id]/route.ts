import { closeTerminal, getTerminal, resizeTerminal, writeTerminal, type TermEvent } from "@/lib/terminals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

// The shell's output as NDJSON: what it printed so far, then everything new,
// then { type: "exit" } when it ends.
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const t = getTerminal(id);
  if (!t) return Response.json({ error: "That terminal has closed" }, { status: 404 });
  const enc = new TextEncoder();
  let stop = () => {};
  const stream = new ReadableStream({
    start(c) {
      const send = (e: TermEvent) => {
        try {
          c.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {}
      };
      const end = () => {
        stop();
        try {
          c.close();
        } catch {}
      };
      if (t.backlog) send({ type: "data", data: t.backlog });
      if (t.exited !== null) {
        send({ type: "exit", code: t.exited });
        return end();
      }
      const listener = (e: TermEvent) => {
        send(e);
        if (e.type === "exit") end();
      };
      t.listeners.add(listener);
      stop = () => t.listeners.delete(listener);
      req.signal.addEventListener("abort", end);
    },
    cancel() {
      stop();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
}

// { data } types into the shell; { cols, rows } resizes it.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { data?: string; cols?: number; rows?: number };
  const ok =
    typeof body.data === "string" ? writeTerminal(id, body.data) : resizeTerminal(id, Number(body.cols), Number(body.rows));
  return ok ? Response.json({ ok: true }) : Response.json({ error: "That terminal has closed" }, { status: 404 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  closeTerminal(id);
  return Response.json({ ok: true });
}
