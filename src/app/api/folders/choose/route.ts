import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The Mac's folder window when Vlens runs in a plain browser (the app shows its
// own, see desktop/preload.cjs). POST { start? } -> { path } or { path: null } if
// you cancelled. Same-origin only (middleware.ts).
const SCRIPT = [
  "on run argv",
  "activate",
  'set p to "Choose a folder for this session"',
  "if (count of argv) > 0 then",
  "  return POSIX path of (choose folder with prompt p default location ((POSIX file (item 1 of argv)) as alias))",
  "end if",
  "return POSIX path of (choose folder with prompt p)",
  "end run",
];

export async function POST(req: Request) {
  if (process.platform !== "darwin") return Response.json({ error: "Only on a Mac." }, { status: 400 });
  const body = (await req.json().catch(() => ({}))) as { start?: string | null };
  const start = typeof body.start === "string" && fs.existsSync(body.start) ? body.start : os.homedir();
  const args = SCRIPT.flatMap((l) => ["-e", l]).concat("--", start);
  const out = await new Promise<{ path: string | null; error?: string }>((resolve) =>
    execFile("osascript", args, { timeout: 10 * 60_000 }, (err, stdout, stderr) => {
      if (err) return resolve(/-128/.test(stderr) ? { path: null } : { path: null, error: stderr.trim() || err.message });
      const p = stdout.trim().replace(/\/$/, "");
      resolve({ path: p || null });
    }),
  );
  return Response.json(out, { status: out.error ? 500 : 200 });
}
