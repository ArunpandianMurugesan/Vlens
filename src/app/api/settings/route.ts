import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isPermissionMode, type PermissionMode } from "@/lib/modes";
import { getSettings, updateSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

// permissions.defaultMode from ~/.claude/settings.json: the mode your terminal `claude` starts in.
async function cliMode(): Promise<PermissionMode> {
  try {
    const d = JSON.parse(await fs.readFile(path.join(os.homedir(), ".claude", "settings.json"), "utf8"));
    const m = d?.permissions?.defaultMode;
    return isPermissionMode(m) ? m : "default";
  } catch {
    return "default";
  }
}

export async function GET() {
  return Response.json({ ...(await getSettings()), cliMode: await cliMode() });
}

export async function PATCH(req: Request) {
  return Response.json({ ...(await updateSettings(await req.json())), cliMode: await cliMode() });
}
