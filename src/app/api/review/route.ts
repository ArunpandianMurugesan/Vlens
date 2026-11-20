import { reviewBoard } from "@/lib/github";
import { watchCheck } from "@/lib/reviewWatchRunner";

export const dynamic = "force-dynamic";

// The PR board. ?fresh skips the one-minute cache. Reading it is also when PRs with
// auto re-review on get their new commits reviewed (reviewWatchRunner.ts): no timer.
export async function GET(req: Request) {
  const board = await reviewBoard(new URL(req.url).searchParams.has("fresh"));
  void watchCheck(board).catch(() => {});
  return Response.json(board);
}
