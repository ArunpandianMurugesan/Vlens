import { reviewBoard } from "@/lib/github";

export const dynamic = "force-dynamic";

// The PR board. ?fresh skips the one-minute cache.
export async function GET(req: Request) {
  return Response.json(await reviewBoard(new URL(req.url).searchParams.has("fresh")));
}
