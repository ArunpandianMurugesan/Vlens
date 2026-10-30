import { openTerminal } from "@/lib/terminals";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Opens a new shell in a folder. { cwd, cols, rows } -> { id, cwd }
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { cwd?: string | null; cols?: number; rows?: number };
  return Response.json(openTerminal(body.cwd ?? null, Number(body.cols), Number(body.rows)));
}
