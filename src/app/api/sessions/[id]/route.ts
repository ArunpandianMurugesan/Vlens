import { deleteSession, renameSession } from "@/lib/manage";
import { setPinned } from "@/lib/pins";
import { forgetRecent } from "@/lib/recent";
import { findSessionFile, getSession } from "@/lib/sessions";
import { threadsForSession } from "@/lib/threads";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// ?since=<updatedAt> skips resending the messages when the file hasn't changed.
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) return Response.json({ error: "not found" }, { status: 404 });
  const threads = await threadsForSession(id);
  if (new URL(req.url).searchParams.get("since") === session.updatedAt) return Response.json({ unchanged: true, threads });
  return Response.json({ session, threads });
}

// { title } renames, { pinned } pins or unpins.
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await findSessionFile(id))) return Response.json({ error: "not found" }, { status: 404 });
  const body = (await req.json()) as { title?: string; pinned?: boolean; recent?: false };

  if (typeof body.title === "string") {
    const title = body.title.replace(/\s+/g, " ").trim().slice(0, 200);
    if (!title) return Response.json({ error: "Name can't be empty" }, { status: 400 });
    await renameSession(id, title);
  }
  if (typeof body.pinned === "boolean") await setPinned(id, body.pinned);
  if (body.recent === false) await forgetRecent(id);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const r = await deleteSession(id);
  return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: r.status });
}
