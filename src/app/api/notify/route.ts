import { execFile } from "node:child_process";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Posts a macOS notification for the Vlens app. Its own web notifications
// are refused by macOS ("not allowed for this application") because the app
// never gets registered with Notification Center, so they go through
// `display notification` instead. Text goes in as arguments, never as script.
export async function POST(req: Request) {
  if (process.platform !== "darwin") return Response.json({ error: "macOS only" }, { status: 400 });
  const b = (await req.json().catch(() => ({}))) as { title?: unknown; body?: unknown };
  const title = String(b.title ?? "Vlens").slice(0, 120);
  const body = String(b.body ?? "").slice(0, 240);
  const script = ["on run argv", 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"', "end run"];
  const ok = await new Promise<boolean>((done) =>
    execFile("osascript", [...script.flatMap((l) => ["-e", l]), title, body], { timeout: 10_000 }, (err) => done(!err)),
  );
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Couldn't post the notification" }, { status: 500 });
}
