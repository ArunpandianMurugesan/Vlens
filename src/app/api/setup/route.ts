import os from "node:os";
import { getSettings } from "@/lib/settings";
import { getSetup } from "@/lib/setup";
import { openInTerminal } from "@/lib/terminal";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getSetup());
}

// Each step runs in a terminal window, so you see what it does and can answer
// its prompts (browser sign-in, Homebrew, your password).
const STEPS: Record<string, string[]> = {
  "install-claude": ["bash", "-c", "curl -fsSL https://claude.ai/install.sh | bash"],
  "login-claude": ["claude", "auth", "login"],
  "install-gh": ["brew", "install", "gh"],
  "login-gh": ["gh", "auth", "login", "--web"],
};

export async function POST(req: Request) {
  const { action } = (await req.json()) as { action?: string };
  const args = action ? STEPS[action] : undefined;
  if (!args) return Response.json({ error: "bad action" }, { status: 400 });
  try {
    await openInTerminal(os.homedir(), args, (await getSettings()).terminalApp);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
