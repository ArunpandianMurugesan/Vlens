import "server-only";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const appleString = (s: string) => `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

// Opens a new terminal window that runs `args` in `cwd`. Used for things that
// need a real terminal: resuming a session, or a sign-in flow.
export async function openInTerminal(cwd: string, args: string[], app: "Terminal" | "iTerm") {
  const cmd = `cd ${shellQuote(cwd)} && ${args.map(shellQuote).join(" ")}`;
  const script =
    app === "iTerm"
      ? `tell application "iTerm"
  activate
  set w to (create window with default profile)
  tell current session of w to write text ${appleString(cmd)}
end tell`
      : `tell application "Terminal"
  activate
  do script ${appleString(cmd)}
end tell`;
  // The first time, macOS asks you to allow controlling the terminal app; the
  // call waits on that dialog, so give it time, but not forever.
  await promisify(execFile)("osascript", ["-e", script], { timeout: 120_000 }).catch((e) => {
    throw new Error(
      e.killed
        ? `Timed out waiting for ${app}. If macOS asked to allow controlling ${app}, click OK and try again.`
        : /not allowed|-1743/i.test(String(e.stderr ?? e.message))
          ? `macOS blocked Vlens from controlling ${app}. Allow it in System Settings → Privacy & Security → Automation.`
          : String(e.stderr || e.message),
    );
  });
}
