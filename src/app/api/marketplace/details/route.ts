import { details } from "@/lib/marketplace";

export const dynamic = "force-dynamic";

// What a plugin contains and how much context it adds: ?id=name@marketplace
export async function GET(req: Request) {
  try {
    return Response.json(await details(new URL(req.url).searchParams.get("id") ?? ""));
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
