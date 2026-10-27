import fs from "node:fs/promises";
import { findSessionFile } from "@/lib/sessions";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/;

// Serves the i-th image of message m from a session file, so the chat can show it.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = new URL(req.url).searchParams;
  const m = u.get("m") ?? "";
  const i = Number(u.get("i"));
  const found = UUID.test(m) && Number.isInteger(i) && i >= 0 ? await findSessionFile(id) : null;
  if (!found) return new Response("not found", { status: 404 });

  const raw = await fs.readFile(found.file, "utf8");
  const line = raw.split("\n").find((l) => l.includes(`"uuid":"${m}"`));
  try {
    const content = JSON.parse(line ?? "").message?.content;
    const img = (Array.isArray(content) ? content : []).filter((c) => c?.type === "image")[i];
    if (img?.source?.type !== "base64") throw new Error();
    return new Response(Buffer.from(img.source.data, "base64"), {
      headers: { "Content-Type": img.source.media_type ?? "image/png", "Cache-Control": "private, max-age=3600" },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
