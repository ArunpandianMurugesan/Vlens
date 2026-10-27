import { openExternally } from "@/lib/files";

export const dynamic = "force-dynamic";

// { path, how: "editor" | "finder", line? }
export async function POST(req: Request) {
  const { path, how, line } = (await req.json()) as { path?: string; how?: "editor" | "finder"; line?: number };
  if (!path || (how !== "editor" && how !== "finder")) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    await openExternally(path, how, Number.isInteger(line) ? line : undefined);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
