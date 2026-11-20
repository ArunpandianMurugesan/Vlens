import { isPrUrl } from "@/lib/reviewRecords";
import { lifecycleState, setFailed, setWatch } from "@/lib/reviewWatch";
import { retryAuto, stopAuto } from "@/lib/reviewWatchRunner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Each PR's review lifecycle: its past reviews and posts, which PRs re-review new
// commits by themselves, and what is running or failed (lifecycle.ts).
export async function GET() {
  return Response.json(await lifecycleState());
}

// { action: "watch" | "unwatch", url, headSha }: switch auto re-review on or off for a PR.
// { action: "stop" | "retry", url }: stop a running auto review, or try a failed one again.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { action?: string; url?: string; headSha?: string };
  const url = String(b.url ?? "");
  if (!isPrUrl(url)) return Response.json({ error: "Which PR?" }, { status: 400 });
  switch (b.action) {
    case "watch":
    case "unwatch": {
      const sha = String(b.headSha ?? "");
      if (b.action === "watch" && !/^[0-9a-f]{40}$/.test(sha)) return Response.json({ error: "Expected the PR's head commit." }, { status: 400 });
      await setWatch(url, b.action === "watch", sha);
      if (b.action === "unwatch") {
        stopAuto(url);
        await setFailed(url, null);
      }
      break;
    }
    case "stop":
      if (!stopAuto(url)) return Response.json({ error: "Nothing is running on that PR." }, { status: 409 });
      break;
    case "retry":
      await retryAuto(url);
      break;
    default:
      return Response.json({ error: "Expected watch, unwatch, stop or retry." }, { status: 400 });
  }
  return Response.json(await lifecycleState());
}
