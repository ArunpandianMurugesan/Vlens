import { rawImage } from "@/lib/files";

export const dynamic = "force-dynamic";

// Image bytes, for previewing images in the file panel.
export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  try {
    const { data, type } = await rawImage(u.get("path") ?? "", u.get("cwd"));
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": type,
        "Cache-Control": "no-store",
        // An SVG can carry script. Opened on its own, it must not run as Vlens.
        "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return new Response((e as Error).message, { status: 400 });
  }
}
