import "server-only";
import { execFile } from "node:child_process";
import { getAccount } from "./account";
import { claudeCmd } from "./cli";
import { getSettings } from "./settings";
import type { SetupStatus } from "./types";

function run(cmd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) =>
    execFile(cmd, args, { timeout: 15_000 }, (e, stdout) => resolve({ ok: !e, out: String(stdout).trim() })),
  );
}

// Checks what a new Mac needs for Lens: Claude Code, a signed-in account, and
// (for Lens Review only) the GitHub CLI.
export async function getSetup(): Promise<SetupStatus> {
  const [version, gh, settings] = await Promise.all([claudeCmd(["--version"]), run("gh", ["api", "user", "--jq", ".login"]), getSettings()]);
  const installed = version.ok;
  const ghInstalled = gh.ok || (await run("gh", ["--version"])).ok;
  return {
    claude: { installed, version: installed ? (version.out.match(/\d+\.\d+\.\d+/)?.[0] ?? version.out.split("\n")[0]) : null },
    account: installed ? await getAccount() : { loggedIn: false, email: null, orgName: null, plan: null, method: null },
    gh: { installed: ghInstalled, user: gh.ok && gh.out ? gh.out : null },
    onboarded: settings.onboarded,
  };
}
