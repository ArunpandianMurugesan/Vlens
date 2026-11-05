/* eslint-disable @typescript-eslint/no-explicit-any -- parses untyped CLI JSON lines */
import "server-only";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { trackRun } from "./lensRuns";
import { recordEvent } from "./limits";
import { noteAsk, settle, waitForDecision } from "./permissions";
import type { AgentEvent, Block, ChatMessage, ImageInput, LiveState, RunStatus, TaskInfo } from "./types";

// What "always allow" would save, worded like the terminal's option. The CLI only
// offers this for some prompts; for safety checks (like `cd` before `git`) it
// doesn't, and the terminal then shows just Yes / No too.
export function alwaysLabel(suggestions: unknown): string | null {
  if (!Array.isArray(suggestions) || !suggestions.length) return null;
  const where = (d?: string) =>
    d === "session" ? " this session" : d === "userSettings" ? " in every project" : d === "projectSettings" ? " in this project (shared)" : " in this project";
  const parts = suggestions.map((s: any) => {
    if (s.type === "addRules" && Array.isArray(s.rules)) {
      const rules = s.rules.map((r: any) => (r.ruleContent ? `${r.toolName}(${r.ruleContent})` : r.toolName)).join(", ");
      return `don't ask again for ${rules}${where(s.destination)}`;
    }
    if (s.type === "setMode" && s.mode === "acceptEdits") return "allow all edits this session";
    if (s.type === "addDirectories" && Array.isArray(s.directories)) return `always allow access to ${s.directories.join(", ")}${where(s.destination)}`;
    return null;
  });
  const text = parts.filter(Boolean).join("; ");
  return text ? text[0].toUpperCase() + text.slice(1) : "Always allow";
}

// The message content for a prompt plus images, as stream-json input wants it.
export function userContent(prompt: string, images: ImageInput[] = []) {
  return [
    ...(prompt ? [{ type: "text", text: prompt }] : []), // the API rejects empty text blocks
    ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } })),
  ];
}

type Listener = (e: AgentEvent) => void;
interface Turn {
  blocks: Block[];
  listen: Listener;
  end: (r: { blocks: Block[]; error?: string }) => void;
}

// One `claude -p` process, spoken to over stream-json on stdin/stdout.
//
// It can stay open after a reply, like the desktop app keeps one claude per
// session: stdin stays open, the next message is written to it, and the
// background agents and commands Claude started keep running. When one of
// them finishes, the CLI starts a turn of its own to tell Claude; that turn
// has no request waiting on it, so its progress is kept for `snapshot()`.
export class ClaudeProc {
  readonly child: ChildProcessWithoutNullStreams;
  sessionId: string | null;
  exited = false;
  autoBusy = false; // Claude is in a turn it started itself (a background task reported back)
  idleSince = Date.now();
  private stderr = "";
  private buf = "";
  private streamed = false; // did this message's text arrive as deltas?
  private status: RunStatus | null = null;
  private turn: Turn | null = null;
  private waiting: (() => void)[] = []; // turns sent while Claude was in one of its own
  private tasks = new Map<string, TaskInfo>(); // sub-agents and background commands
  private asks = new Map<string, Extract<AgentEvent, { type: "permission" }>>(); // questions still waiting on you
  private controls = new Map<string, (ok: boolean) => void>(); // our control requests, by id
  private exitListeners: (() => void)[] = [];

  constructor(
    args: string[],
    cwd: string | null,
    sessionId: string | null,
    private readonly o: { oneShot?: boolean; onSession?: (id: string) => void; entrypoint?: string } = {},
  ) {
    this.sessionId = sessionId;
    const env = { ...process.env };
    delete env.CLAUDECODE; // don't let the child think it's nested inside another session
    // Who started it, saved in the session file. The CLI marks `-p` runs "sdk-cli"
    // and leaves those out of `claude --resume` and `--continue` in the terminal;
    // a name of our own keeps your Vlens sessions there. Without one, the CLI
    // decides (and a name inherited from whoever started Vlens is dropped).
    if (o.entrypoint) env.CLAUDE_CODE_ENTRYPOINT = o.entrypoint;
    else delete env.CLAUDE_CODE_ENTRYPOINT;
    this.child = spawn(
      "claude",
      [
        "-p",
        // stream-json input lets one message carry text and images; slash commands still work.
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        // Ask Vlens (over stdin/stdout) before running anything that needs approval,
        // instead of denying it because nobody is at a terminal.
        "--permission-prompt-tool", "stdio",
        ...args,
      ],
      { cwd: cwd && fs.existsSync(cwd) ? cwd : os.homedir(), env, stdio: ["pipe", "pipe", "pipe"] },
    );
    trackRun(this.child);
    this.child.stdin.on("error", () => {}); // writes after it exits
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString();
      let nl: number;
      while ((nl = this.buf.indexOf("\n")) >= 0) {
        const line = this.buf.slice(0, nl);
        this.buf = this.buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          this.handle(JSON.parse(line));
        } catch {}
      }
    });
    this.child.stderr.on("data", (c: Buffer) => (this.stderr += c.toString()));
    this.child.on("error", (err) => this.exit(`Could not start claude: ${err.message}`));
    this.child.on("close", (code) => this.exit(code === 0 ? null : this.stderr.trim() || `claude exited with code ${code}`));
  }

  // Whether nothing is going on: no reply, no background work, no open question.
  get idle() {
    return !this.turn && !this.autoBusy && !this.asks.size && ![...this.tasks.values()].some((t) => t.status === "running");
  }

  onExit(cb: () => void) {
    this.exitListeners.push(cb);
  }

  // What's going on outside of any reply you're waiting on, for the session view.
  snapshot(): LiveState {
    const recent = Date.now() - 120_000;
    return {
      busy: this.autoBusy,
      status: this.autoBusy ? this.status : null,
      tasks: [...this.tasks.values()].filter((t) => t.status === "running" || t.startedAt + t.ms > recent).map((t) => ({ ...t })),
      asks: this.turn ? [] : [...this.asks.values()],
    };
  }

  // Sends a message and streams its turn to `listen` until Claude is done with it.
  runTurn(content: unknown[], listen: Listener, signal?: AbortSignal): Promise<{ blocks: Block[]; error?: string }> {
    return new Promise((end) => {
      if (this.exited) return end({ blocks: [], error: "Claude isn't running anymore." });
      const turn: Turn = { blocks: [], listen, end };
      const start = () => {
        if (signal?.aborted || this.exited) return end({ blocks: [], ...(this.exited ? { error: "Claude isn't running anymore." } : {}) });
        // Finished tasks from earlier replies drop off; running ones stay.
        for (const [id, t] of this.tasks) if (t.status !== "running") this.tasks.delete(id);
        this.turn = turn;
        // Background work from earlier replies shows in this one too.
        for (const t of this.tasks.values()) listen({ type: "task", task: { ...t } });
        this.write({ type: "user", message: { role: "user", content } });
      };
      // Claude is busy telling itself about a background task: go right after.
      if (this.autoBusy || this.turn) this.waiting.push(start);
      else start();
      // Stop: end this reply, but keep the process (and its background work) going.
      signal?.addEventListener("abort", () => {
        if (this.o.oneShot) return void this.child.kill("SIGTERM");
        if (this.turn !== turn) return; // still waiting its turn (it won't start), or long done
        for (const id of this.asks.keys()) settle(id, "deny");
        void this.control({ subtype: "interrupt" });
      });
    });
  }

  // A control request to the CLI (interrupt, set_permission_mode, set_model). Resolves to whether it worked.
  control(request: Record<string, unknown>): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.exited) return resolve(false);
      const id = randomUUID();
      this.controls.set(id, resolve);
      this.write({ type: "control_request", request_id: id, request });
      setTimeout(() => this.controls.delete(id) && resolve(false), 10_000);
    });
  }

  close() {
    if (!this.child.stdin.writableEnded) this.child.stdin.end(); // the CLI exits once stdin ends
    setTimeout(() => !this.exited && this.child.kill("SIGTERM"), 5_000);
  }

  private write(msg: unknown) {
    if (!this.child.stdin.writableEnded) this.child.stdin.write(JSON.stringify(msg) + "\n");
  }

  // To the reply being waited on, if any. Claude's own turns have nobody listening.
  private emit(e: AgentEvent) {
    this.turn?.listen(e);
  }

  private endTurn(error?: string) {
    const t = this.turn;
    if (!t) return;
    this.turn = null;
    this.idleSince = Date.now();
    t.end({ blocks: t.blocks, ...(error && !t.blocks.some((b) => b.kind === "text") ? { error } : {}) });
  }

  private next() {
    const go = this.waiting.shift();
    if (go) go();
  }

  private exit(error: string | null) {
    if (this.exited) return;
    this.exited = true;
    for (const id of this.asks.keys()) settle(id, "deny"); // the run ended; drop open questions
    for (const r of this.controls.values()) r(false);
    this.controls.clear();
    for (const t of this.tasks.values()) if (t.status === "running") t.status = "killed";
    this.endTurn(error ?? undefined);
    for (const go of this.waiting.splice(0)) go(); // each ends at once: exited
    for (const cb of this.exitListeners) cb();
  }

  private handle(ev: any) {
    if (ev.type === "control_request") {
      if (ev.request?.subtype === "can_use_tool") void this.askPermission(ev);
      // Anything else we don't support: say so, rather than leave the CLI waiting.
      else this.write({ type: "control_response", response: { subtype: "error", request_id: ev.request_id, error: "Not supported by Vlens" } });
      return;
    }
    if (ev.type === "control_response") {
      const r = ev.response;
      const done = this.controls.get(r?.request_id);
      if (done) {
        this.controls.delete(r.request_id);
        done(r.subtype === "success");
      }
      return;
    }
    recordEvent(ev); // keeps the plan usage and context window sizes current
    if (ev.session_id && ev.session_id !== this.sessionId) {
      this.sessionId = ev.session_id;
      this.emit({ type: "session", claudeSessionId: ev.session_id });
      this.o.onSession?.(ev.session_id);
    }
    if (ev.type === "result") {
      if (this.o.oneShot) {
        // One question, one answer: let the CLI exit (it waits for background work first).
        this.child.stdin.end();
        return;
      }
      this.status = null;
      if (this.turn) this.endTurn();
      else this.autoBusy = false;
      this.idleSince = Date.now();
      this.next();
      return;
    }
    if (ev.type === "system") return this.onSystem(ev);
    // A sub-agent's own messages: shown as its progress (see onSystem), not as the reply.
    if (ev.parent_tool_use_id) return;
    if (!this.turn && (ev.type === "stream_event" || ev.type === "assistant")) this.autoBusy = true;
    const blocks = this.turn?.blocks;
    if (ev.type === "stream_event") {
      const d = ev.event?.delta;
      const cb = ev.event?.content_block;
      if (ev.event?.type === "content_block_start" && cb) {
        if (cb.type === "thinking" || cb.type === "redacted_thinking") this.setStatus({ kind: "thinking" });
        else if (cb.type === "text") this.setStatus({ kind: "writing" });
        else if (cb.type === "tool_use") this.setStatus({ kind: "tool", tool: cb.name });
      }
      if (ev.event?.type === "content_block_delta" && d?.type === "text_delta") {
        this.streamed = true;
        this.emit({ type: "delta", text: d.text });
      }
      return;
    }
    const content = ev.message?.content;
    if (!Array.isArray(content)) return;
    const wasStreamed = this.streamed;
    this.streamed = false;
    for (const c of content) {
      if (ev.type === "assistant" && c.type === "text" && c.text) {
        blocks?.push({ kind: "text", text: c.text });
        // Slash command output (e.g. /context) comes whole, not as deltas.
        if (!wasStreamed) this.emit({ type: "delta", text: c.text });
      } else if (ev.type === "assistant" && c.type === "tool_use") {
        blocks?.push({ kind: "tool_use", id: c.id, name: c.name, input: c.input });
        this.emit({ type: "tool", id: c.id, name: c.name, input: c.input });
      } else if (ev.type === "user" && c.type === "tool_result") {
        const text =
          typeof c.content === "string"
            ? c.content
            : Array.isArray(c.content)
              ? c.content.map((x: any) => x.text ?? "").join("\n")
              : "";
        blocks?.push({ kind: "tool_result", toolUseId: c.tool_use_id, text, isError: !!c.is_error });
        this.emit({ type: "tool_result", toolUseId: c.tool_use_id, text, isError: !!c.is_error });
      }
    }
  }

  private setStatus(s: RunStatus) {
    this.status = s;
    this.emit({ type: "status", status: s });
  }

  // What Claude is up to between messages: waiting on the API, and the
  // sub-agents and background commands it started, with their progress.
  private onSystem(ev: any) {
    if (ev.subtype === "status" && ev.status === "requesting") return this.setStatus({ kind: "requesting" });
    if (!ev.task_id || !["task_started", "task_progress", "task_updated", "task_notification"].includes(ev.subtype)) return;
    const t: TaskInfo = this.tasks.get(ev.task_id) ?? {
      id: ev.task_id,
      toolUseId: ev.tool_use_id ?? null,
      parentId: ev.parent_task_id ?? null,
      kind: ev.task_type ?? "local_agent",
      agentType: ev.subagent_type ?? null,
      description: ev.description ?? "",
      background: !!ev.is_backgrounded,
      status: "running",
      lastTool: null,
      activity: null,
      toolUses: 0,
      tokens: 0,
      startedAt: Date.now(),
      ms: 0,
    };
    if (ev.subtype === "task_started") {
      // A background agent is started again when its own background work reports back.
      t.status = "running";
    } else if (ev.subtype === "task_progress") {
      if (ev.last_tool_name && ev.last_tool_name !== "SubagentHandback") t.lastTool = ev.last_tool_name;
      // The progress description is what it's doing now ("Reading a.txt"), not its name.
      if (ev.description && ev.description !== t.description) t.activity = ev.description;
      t.toolUses = ev.usage?.tool_uses ?? t.toolUses;
      t.tokens = ev.usage?.total_tokens ?? t.tokens;
    } else {
      const s = ev.patch?.status ?? ev.status;
      if (s === "completed" || s === "failed" || s === "killed") t.status = s;
    }
    t.ms = Date.now() - t.startedAt;
    this.tasks.set(t.id, t);
    this.emit({ type: "task", task: { ...t } });
  }

  // The CLI asks before running a tool that needs approval. Show it in Vlens and wait.
  private async askPermission(ev: any) {
    const r = ev.request;
    const id: string = ev.request_id;
    const ask = (e: Extract<AgentEvent, { type: "permission" }>) => {
      this.asks.set(id, e);
      noteAsk({ id, tool: e.tool, input: e.input, always: !!e.always, sessionId: this.sessionId });
      this.emit(e);
    };
    const reply = (response: unknown, done: Extract<AgentEvent, { type: "permission_done" }>) => {
      this.asks.delete(id);
      this.emit(done);
      this.write({ type: "control_response", response: { subtype: "success", request_id: id, response } });
    };
    // Claude asking you something (AskUserQuestion): Vlens shows the choices, and your
    // picks go back as the tool's `answers`, like choosing them in the terminal.
    if (r.tool_name === "AskUserQuestion") {
      ask({ type: "permission", id, tool: r.tool_name, input: r.input, description: null, reason: null, always: null, questions: r.input?.questions ?? [] });
      const got = await waitForDecision(id);
      const answered = typeof got === "object" && "answers" in got;
      return reply(
        answered ? { behavior: "allow", updatedInput: { ...r.input, answers: got.answers } } : { behavior: "deny", message: "The user skipped the question in Vlens." },
        { type: "permission_done", id, decision: answered ? "allow" : "deny" },
      );
    }
    // Claude is done planning (ExitPlanMode): show the plan, like the terminal's
    // "Would you like to proceed?" with the mode to carry on in.
    if (r.tool_name === "ExitPlanMode") {
      ask({ type: "permission", id, tool: r.tool_name, input: r.input, description: null, reason: null, always: null, plan: String(r.input?.plan ?? "") });
      const got = await waitForDecision(id);
      const mode = typeof got === "object" && "approve" in got ? got.approve : null;
      const feedback = typeof got === "object" && "deny" in got ? got.deny : null;
      return reply(
        mode
          ? { behavior: "allow", updatedInput: r.input, updatedPermissions: [{ type: "setMode", mode, destination: "session" }] }
          : {
              behavior: "deny",
              message: feedback
                ? `The user doesn't want to proceed with this plan yet. Keep planning. The user said: ${feedback}`
                : "The user doesn't want to proceed with this tool use. The tool use was rejected. STOP what you are doing and wait for the user to tell you how to proceed.",
              ...(feedback ? {} : { interrupt: true }),
            },
        { type: "permission_done", id, decision: mode ? "allow" : "deny", ...(mode ? { mode } : {}) },
      );
    }
    ask({
      type: "permission",
      id,
      tool: r.display_name ?? r.tool_name,
      input: r.input,
      description: r.description ?? null,
      reason: r.decision_reason ?? null,
      always: alwaysLabel(r.permission_suggestions),
    });
    const got = await waitForDecision(id);
    const feedback = typeof got === "object" && "deny" in got ? got.deny : null;
    const d = typeof got === "string" ? got : feedback !== null ? "deny" : "allow";
    reply(
      d === "deny"
        ? {
            behavior: "deny",
            // Same wording the terminal gives Claude, so it changes course instead of retrying.
            message: feedback
              ? `The user doesn't want to proceed with this tool use. The tool use was rejected. The user said: ${feedback}`
              : "The user doesn't want to proceed with this tool use. The tool use was rejected. STOP what you are doing and wait for the user to tell you how to proceed.",
            ...(feedback ? {} : { interrupt: true }),
          }
        : {
            behavior: "allow",
            updatedInput: r.input,
            // "Always": save the CLI's own suggested rule (same as choosing "always" in the terminal).
            ...(d === "always" && r.permission_suggestions ? { updatedPermissions: r.permission_suggestions } : {}),
          },
      { type: "permission_done", id, decision: d },
    );
  }
}

// A turn's events as the NDJSON response the browser reads, ending with
// "done" (or "error") once Claude has answered.
export function turnResponse(
  proc: Pick<ClaudeProc, "sessionId" | "runTurn">, // a bot's SDK run works the same way (botAgent.ts)
  content: unknown[],
  signal: AbortSignal,
  onFinish: (blocks: Block[], sessionId: string | null) => Promise<ChatMessage>,
  first?: AgentEvent,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {}
      };
      if (first) send(first);
      // A session we already know: say so first, like a new one does once it has an id.
      if (proc.sessionId) send({ type: "session", claudeSessionId: proc.sessionId });
      const r = await proc.runTurn(content, send, signal);
      if (r.error) send({ type: "error", error: r.error });
      else send({ type: "done", message: await onFinish(r.blocks, proc.sessionId) });
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" } });
}

interface Options {
  prompt: string; // sent on stdin, so text starting with "-" is never read as a flag
  images?: ImageInput[];
  args: string[]; // extra args after the stream-json flags
  cwd: string | null;
  signal: AbortSignal;
  sessionId: string | null; // known CLI session id, if resuming
  first?: AgentEvent; // sent before anything else
  onSession?: (id: string) => void;
  // Called once the CLI exits with some output. Returns the message to send as "done".
  onFinish: (blocks: Block[], sessionId: string | null) => Promise<ChatMessage>;
}

// Runs one `claude -p` reply to the end (background work included) and relays it
// to the browser as newline-delimited AgentEvents. For sub-agent threads; the main
// chat keeps its process open instead (see liveSessions.ts).
export function streamClaude(o: Options): Response {
  const proc = new ClaudeProc(o.args, o.cwd, o.sessionId, { oneShot: true, onSession: o.onSession });
  return turnResponse(proc, userContent(o.prompt, o.images), o.signal, o.onFinish, o.first);
}

// Runs one `claude -p` turn to completion and returns the reply text. For short
// jobs whose answer the server needs (a handoff note, /compact), not for chat.
export function runClaudeOnce(o: { prompt: string; args: string[]; cwd: string | null; timeoutMs?: number }): Promise<{ ok: boolean; text: string; error?: string }> {
  const cwd = o.cwd && fs.existsSync(o.cwd) ? o.cwd : os.homedir();
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", "--output-format", "stream-json", "--verbose", ...o.args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    trackRun(child);
    child.stdin.end(o.prompt);
    let buf = "";
    let result: any = null;
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      buf += c.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const ev = JSON.parse(line);
          recordEvent(ev);
          if (ev.type === "result") result = ev;
        } catch {}
      }
    });
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    const timer = setTimeout(() => child.kill("SIGTERM"), o.timeoutMs ?? 5 * 60_000);
    child.on("close", () => {
      clearTimeout(timer);
      if (result && !result.is_error) resolve({ ok: true, text: String(result.result ?? "") });
      else resolve({ ok: false, text: "", error: String(result?.result || stderr.trim() || "Claude didn't finish.").slice(0, 400) });
    });
    child.on("error", (e) => resolve({ ok: false, text: "", error: e.message }));
  });
}
