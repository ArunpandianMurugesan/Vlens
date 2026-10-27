import os from "node:os";
import { getAccount } from "@/lib/account";
import { claudeCmd } from "@/lib/cli";
import { getSettings } from "@/lib/settings";
import { openInTerminal } from "@/lib/terminal";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getAccount());
}

// Sign-in needs a browser round trip, so it runs in a terminal window; sign-out doesn't.
export async function POST(req: Request) {
  const { action } = (await req.json()) as { action: "login" | "logout" };
  if (action === "login") {
    await openInTerminal(os.homedir(), ["claude", "auth", "login"], (await getSettings()).terminalApp);
    return Response.json({ ok: true });
  }
  if (action === "logout") {
    const r = await claudeCmd(["auth", "logout"]);
    return r.ok ? Response.json(await getAccount()) : Response.json({ error: r.out }, { status: 500 });
  }
  return Response.json({ error: "bad action" }, { status: 400 });
}
