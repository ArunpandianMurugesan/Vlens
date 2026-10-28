/* eslint-disable @typescript-eslint/no-explicit-any -- reads untyped CLI JSON events */
import "server-only";
import { spawn } from "node:child_process";
import os from "node:os";
import { jsonStore } from "./jsonStore";
import { trackRun } from "./lensRuns";
import type { Limits, LimitWindow } from "./types";

// Every `claude -p` run streams a rate_limit_event with the plan's 5-hour and
// weekly usage, its result lists each model's context window, and its init
// event lists the slash commands. We keep the latest of each so the UI can
// show them without asking the API itself.
const store = jsonStore<Limits>("limits.json", () => ({ windows: null, updatedAt: null, contextWindows: {} }));

export const getLimits = store.load;

function toWindow(w: any): LimitWindow | null {
  return w && typeof w.utilization === "number"
    ? { utilization: w.utilization, resetsAt: w.resetsAt, status: w.status ?? "allowed" }
    : null;
}

// Called for every event from a Claude run.
export function recordEvent(ev: any) {
  if (ev.type === "system" && ev.subtype === "init" && Array.isArray(ev.slash_commands) && ev.cwd) {
    // Leave out ones that only work in a real terminal, and internal ones.
    const terminalOnly = new Set<string>(ev.terminal_slash_commands ?? []);
    const cmds = (ev.slash_commands as string[]).filter((c) => !terminalOnly.has(c) && !c.startsWith("__"));
    void store.update((s) => {
      s.commands = { ...s.commands, [ev.cwd]: cmds };
    });
  } else if (ev.type === "rate_limit_event") {
    const u = ev.rate_limit_info?.unifiedWindows;
    const fiveHour = toWindow(u?.five_hour);
    const sevenDay = toWindow(u?.seven_day);
    if (!fiveHour && !sevenDay) return;
    void store.update((s) => {
      s.windows = { fiveHour, sevenDay };
      s.updatedAt = new Date().toISOString();
    });
  } else if (ev.type === "result" && ev.modelUsage) {
    const sizes = Object.entries(ev.modelUsage as Record<string, any>).filter(([, m]) => m?.contextWindow > 0);
    if (!sizes.length) return;
    void store.update((s) => {
      for (const [model, m] of sizes) s.contextWindows[model] = m.contextWindow;
    });
  }
}

// The cheapest possible run (no tools, no MCP, no saved session), just to get a
// fresh rate_limit_event. Uses Haiku (a fraction of a cent) unless `model` is
// given, which we do once per model to learn its context window size.
export function probe(model = "claude-haiku-5-5", cwd = os.tmpdir()): Promise<void> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.CLAUDECODE;
    const child = spawn(
      "claude",
      [
        "-p",
        "--output-format", "stream-json",
        "--verbose",
        "--no-session-persistence",
        "--model", model,
        "--system-prompt", "Reply with ok.",
        "--tools", "",
        "--strict-mcp-config",
        "--max-turns", "1",
      ],
      { cwd, env, stdio: ["pipe", "pipe", "ignore"] },
    );
    trackRun(child);
    child.stdin.end("ok");
    let buf = "";
    child.stdout.on("data", (c: Buffer) => {
      buf += c.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          recordEvent(JSON.parse(line));
        } catch {}
      }
    });
    const timer = setTimeout(() => child.kill(), 60_000);
    child.on("close", () => {
      clearTimeout(timer);
      // recordEvent queues its write; wait for it so the caller reads fresh data.
      void store.update(() => {}).then(() => resolve());
    });
    child.on("error", () => resolve());
  });
}

// Context window for a model we've seen in a run; otherwise a best guess.
export function contextWindowFor(model: string | null, used: number, known: Record<string, number>) {
  if (model && known[model]) return { window: known[model], estimated: false };
  return { window: used > 200_000 ? 1_000_000 : 200_000, estimated: true };
}
