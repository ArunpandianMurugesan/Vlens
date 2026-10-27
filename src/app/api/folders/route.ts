import os from "node:os";
import path from "node:path";
import { listDirs, resolveDir } from "@/lib/folders";

export const dynamic = "force-dynamic";

// Folder browser for "New session": GET /api/folders?path=~/Desktop
export async function GET(req: Request) {
  const asked = new URL(req.url).searchParams.get("path") || "~";
  const dir = await resolveDir(asked);
  if (!dir) return Response.json({ error: "Not a folder" }, { status: 404 });
  return Response.json({
    path: dir,
    parent: dir === path.parse(dir).root ? null : path.dirname(dir),
    home: os.homedir(),
    dirs: await listDirs(dir),
  });
}
