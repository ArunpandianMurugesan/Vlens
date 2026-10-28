import { isTracked, saveLesson, updateLesson } from "@/lib/coach";

export const dynamic = "force-dynamic";

// Add a lesson by hand (from a signal), or check whether a project's CLAUDE.md is in git.
export async function POST(req: Request) {
  const b = (await req.json()) as { text?: string; cwd?: string | null; sessionId?: string; checkTracked?: string };
  if (b.checkTracked) return Response.json({ tracked: await isTracked(b.checkTracked) });
  if (!b.text?.trim()) return Response.json({ error: "text required" }, { status: 400 });
  return Response.json(await saveLesson(b.text, b.cwd ?? null, b.sessionId));
}

// Edit, apply to a CLAUDE.md ("project" / "user"), take out of it (null), or delete.
export async function PATCH(req: Request) {
  const b = (await req.json()) as { id?: string; text?: string; apply?: "project" | "user" | null; remove?: boolean };
  if (!b.id) return Response.json({ error: "id required" }, { status: 400 });
  if (b.apply !== undefined && b.apply !== null && b.apply !== "project" && b.apply !== "user") return Response.json({ error: "bad target" }, { status: 400 });
  try {
    await updateLesson(b.id, b);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
