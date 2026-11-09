import { resolveDir } from "@/lib/folders";
import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// What a picker command (/effort, /output-style, /config) offers, as the CLI
// prints it when run with no value. In Vlens's non-interactive Claude those
// commands print their choices instead of showing a menu; Vlens reads the
// choices from that text and draws the menu itself. The run asks no model
// and saves no session.
const PICKERS = new Set(["effort", "output-style", "config"]);

const g = globalThis as { lensSlash?: Map<string, { at: number; text: string }> };
const cache = (g.lensSlash ??= new Map());

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const cmd = q.get("cmd") ?? "";
  if (!PICKERS.has(cmd)) return Response.json({ error: "Not a picker command" }, { status: 400 });
  const cwd = (await resolveDir(q.get("cwd") ?? "")) ?? null;
  const key = `${cmd}\0${cwd ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return Response.json({ text: hit.text });
  const r = await (await getProvider()).runOnce({ prompt: `/${cmd}`, args: ["--no-session-persistence"], cwd, timeoutMs: 30_000 });
  if (!r.ok) return Response.json({ error: r.error ?? "Couldn't ask Claude" }, { status: 500 });
  cache.set(key, { at: Date.now(), text: r.text });
  return Response.json({ text: r.text });
}
