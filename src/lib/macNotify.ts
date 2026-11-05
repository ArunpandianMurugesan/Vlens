import "server-only";
import { execFile } from "node:child_process";

// A macOS notification. The Vlens app's own web notifications are refused by
// macOS ("not allowed for this application") because the app never gets
// registered with Notification Center, so they go through `display
// notification`. Text goes in as arguments, never as script.
export function macNotify(title: string, body: string): Promise<boolean> {
  if (process.platform !== "darwin") return Promise.resolve(false);
  const script = ["on run argv", 'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"', "end run"];
  return new Promise((done) =>
    execFile("osascript", [...script.flatMap((l) => ["-e", l]), title.slice(0, 120), body.slice(0, 240)], { timeout: 10_000 }, (err) => done(!err)),
  );
}
