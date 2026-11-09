import { BOTS_DIR } from "@/lib/bots";
import { getProvider } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Every folder your Claude sessions ran in (terminal, desktop app, Vlens), for a
// bot's "Read my Claude sessions" picker. Not the sidebar's list: that's only recent ones.
export async function GET() {
  const counts = new Map<string, number>();
  for (const s of await (await getProvider()).listSessions()) if (s.cwd && !s.botId && !s.cwd.startsWith(BOTS_DIR)) counts.set(s.cwd, (counts.get(s.cwd) ?? 0) + 1);
  return Response.json({ folders: [...counts].map(([path, sessions]) => ({ path, sessions })).sort((a, b) => a.path.localeCompare(b.path)) });
}
