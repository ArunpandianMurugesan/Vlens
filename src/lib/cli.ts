import "server-only";
import { execFile } from "node:child_process";
import os from "node:os";

// Runs a short `claude <args>` command and returns its output.
export function claudeCmd(args: string[], cwd = os.homedir()): Promise<{ ok: boolean; out: string }> {
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return new Promise((resolve) => {
    execFile("claude", args, { cwd, env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: `${stdout}${stderr ? `\n${stderr}` : ""}`.trim() }),
    );
  });
}
