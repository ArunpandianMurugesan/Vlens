import { listThings } from "@/lib/brain/store";
import { THING_TYPES, type ThingType } from "@/lib/brain/things";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The things the brain knows about (tickets, PRs, repos, people…), with how many memories each has.
export async function GET(req: Request) {
  const type = new URL(req.url).searchParams.get("type") as ThingType | null;
  return Response.json({ things: await listThings({ type: type && THING_TYPES.includes(type) ? type : undefined }) });
}
