import { signOut, startLogin, status } from "@/lib/harness/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Vlens's own harness sign-in: GET whether you're in, POST to start (returns the
// harness's sign-in page to open), DELETE to sign out.
export async function GET() {
  return Response.json(await status());
}

export async function POST(req: Request) {
  try {
    return Response.json({ url: await startLogin(new URL(req.url).origin) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}

export async function DELETE() {
  await signOut();
  return Response.json({ ok: true });
}
