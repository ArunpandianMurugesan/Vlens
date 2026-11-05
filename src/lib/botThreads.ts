import "server-only";
import { BotRun } from "./botAgent";
import { getIssue, setIssueMeta } from "./botIssues";
import { alertBot, markTargetRead } from "./botNotifications";
import { getBot } from "./bots";
import { userContent } from "./runClaude";
import type { AgentEvent, RunStatus } from "./types";

// Issue threads running in the background: each card in a bot's chat is a
// session of its own, worked on by the bot while you do something else (or
// close the window). Its history is the session file; what's going on right
// now (the reply so far, the questions waiting on you) is kept here, so the
// cards can show it and you can answer from the card or the bell.

type Ask = Extract<AgentEvent, { type: "permission" }>;
export interface ThreadState {
  running: boolean;
  prompt: string | null; // the message being answered
  text: string; // the reply so far
  status: RunStatus | null;
  tools: { id: string; name: string; input: unknown }[];
  asks: Ask[];
  error: string | null;
}

const ASK_WAIT_MS = 24 * 60 * 60_000; // nobody may be watching a card for a while

const g = globalThis as { lensBotThreads?: Map<string, ThreadState & { stop?: AbortController }> };
const all = (g.lensBotThreads ??= new Map());
const idle = (): ThreadState => ({ running: false, prompt: null, text: "", status: null, tools: [], asks: [], error: null });
const k = (botId: string, key: string) => `${botId}:${key}`;

export function threadState(botId: string, key: string): ThreadState {
  const s = all.get(k(botId, key));
  if (!s) return idle();
  const { stop: _stop, ...rest } = s;
  void _stop;
  return rest;
}

// Sends a message in the issue's thread and returns at once; the reply runs on.
// onDone: told when the reply ends (the watch uses it to ring the bell).
export function runIssue(botId: string, key: string, prompt: string, onDone?: (r: { error: string | null }) => void): { ok: true } | { ok: false; error: string } {
  const at = k(botId, key);
  if (all.get(at)?.running) return { ok: false, error: `${key} is still working on the last message. Wait for it, or stop it on its card.` };
  const stop = new AbortController();
  const s: ThreadState & { stop?: AbortController } = { ...idle(), running: true, prompt, stop };
  all.set(at, s);
  void (async () => {
    try {
      const [bot, issue] = await Promise.all([getBot(botId), getIssue(botId, key)]);
      if (!bot || !issue) throw new Error(bot ? `No issue ${key}.` : "Bot not found.");
      const run = new BotRun(bot, issue.thread, (sid) => void setIssueMeta(botId, key, { thread: sid }), { issue: key, askTimeoutMs: ASK_WAIT_MS });
      const r = await run.runTurn(
        userContent(prompt),
        (e) => {
          if (e.type === "delta") s.text += e.text;
          else if (e.type === "status") s.status = e.status;
          else if (e.type === "tool") s.tools.push({ id: e.id, name: e.name, input: e.input });
          else if (e.type === "permission") {
            s.asks.push(e);
            void alertBot(bot, "needsYou", { title: `${key} needs you`, body: e.preview ?? e.tool, target: { kind: "issue", key } });
          } else if (e.type === "permission_done") {
            s.asks = s.asks.filter((a) => a.id !== e.id);
            if (!s.asks.length) void markTargetRead(botId, key);
          }
        },
        stop.signal,
      );
      s.error = r.error ?? null;
    } catch (e) {
      s.error = (e as Error).message;
    } finally {
      void markTargetRead(botId, key); // nothing waits on you once it's done
      onDone?.({ error: s.error });
      s.running = false;
      s.status = null;
      s.asks = [];
      s.prompt = null;
      s.text = "";
      s.tools = [];
    }
  })();
  return { ok: true };
}

export function stopIssue(botId: string, key: string) {
  all.get(k(botId, key))?.stop?.abort();
}
