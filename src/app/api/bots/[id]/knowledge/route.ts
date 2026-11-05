import { conceptTemplate, deleteConcept, getBot, listConcepts, readConcept, writeConcept } from "@/lib/bots";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };
const fail = (e: unknown, status = 400) => Response.json({ error: (e as Error).message }, { status });

// No ?path: the list of concepts. ?path=…: that file's text.
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!(await getBot(id))) return fail(new Error("Bot not found."), 404);
  const rel = new URL(req.url).searchParams.get("path");
  try {
    return rel ? Response.json({ path: rel, text: await readConcept(id, rel) }) : Response.json({ concepts: await listConcepts(id) });
  } catch (e) {
    return fail(e);
  }
}

// { path, text } saves a file; { path, title, type } makes a new one from the template.
export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { path?: string; text?: string; title?: string; type?: string };
  if (!body.path) return fail(new Error("path required"));
  try {
    const text = body.text ?? conceptTemplate(body.title || body.path.split("/").pop()!.replace(/\.md$/, ""), body.type || "topic");
    await writeConcept(id, body.path, text.slice(0, 500_000));
    return Response.json({ ok: true, text });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const rel = new URL(req.url).searchParams.get("path");
  if (!rel) return fail(new Error("path required"));
  try {
    await deleteConcept(id, rel);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
