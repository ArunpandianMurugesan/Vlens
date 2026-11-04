import { resolveDir } from "@/lib/folders";
import { worktreeInfo } from "@/lib/worktree";

export const dynamic = "force-dynamic";

// Whether a new session in this folder can get its own worktree.
export async function GET(req: Request) {
  const cwd = await resolveDir(new URL(req.url).searchParams.get("cwd") ?? "");
  if (!cwd) return Response.json({ ok: false, reason: "That folder doesn't exist." });
  return Response.json(await worktreeInfo(cwd));
}
