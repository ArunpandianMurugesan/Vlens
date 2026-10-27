import { rawImage } from "@/lib/files";

export const dynamic = "force-dynamic";

// Image bytes, for previewing images in the file panel.
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  try {
    const { data, type } = await rawImage(u.get("path") ?? "", u.get("cwd"));
    return new Response(new Uint8Array(data), { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }
}
