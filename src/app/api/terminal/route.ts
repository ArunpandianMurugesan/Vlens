import { openTerminal } from "@/lib/terminals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// A shell to connect to over its WebSocket: { id? (reconnect), cwd, cols, rows }
// -> { id, cwd, port, token }. Same-origin only (middleware.ts), so only Vlens's
// own pages can get a token.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { id?: string; cwd?: string | null; cols?: number; rows?: number };
  try {
    return Response.json(await openTerminal({ id: body.id, cwd: body.cwd ?? null, cols: Number(body.cols), rows: Number(body.rows) }));
  } catch (e) {
    return Response.json({ error: `Couldn't start a shell: ${(e as Error).message}` }, { status: 500 });
  }
}
