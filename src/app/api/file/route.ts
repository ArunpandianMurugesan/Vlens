import { readView } from "@/lib/files";

export const dynamic = "force-dynamic";

// A file (highlighted) or folder listing: ?path=…&cwd=… (relative paths resolve against cwd).
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  try {
    return Response.json(await readView(u.get("path") ?? "", u.get("cwd")));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
