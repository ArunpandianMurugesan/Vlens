/* eslint-disable @typescript-eslint/no-explicit-any -- parses untyped CLI JSON lines */
import "server-only";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { recordEvent } from "./limits";
import { type Decision, settle, waitForDecision } from "./permissions";
import type { AgentEvent, Block, ChatMessage, ImageInput } from "./types";

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

// Runs `claude -p` with streaming JSON output and relays it to the browser as
// newline-delimited AgentEvents.
export function streamClaude(o: Options): Response {
  // stream-json input lets one message carry text and images; slash commands still work.
  const args = [
    "-p",
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    // Ask Lens (over stdin/stdout) before running anything that needs approval,
    // instead of denying it because nobody is at a terminal.
    "--permission-prompt-tool", "stdio",
    ...o.args,
  ];
  const content = [
    ...(o.prompt ? [{ type: "text", text: o.prompt }] : []), // the API rejects empty text blocks
    ...(o.images ?? []).map((im) => ({ type: "image", source: { type: "base64", media_type: im.mediaType, data: im.data } })),
  ];
  const cwd = o.cwd && fs.existsSync(o.cwd) ? o.cwd : os.homedir();
  const env = { ...process.env };
  delete env.CLAUDECODE; // don't let the child think it's nested inside another session

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: AgentEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {}
      };
      const close = () => {
        try {
          controller.close();
        } catch {}
      };
      if (o.first) send(o.first);

      const child = spawn("claude", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
      // stdin stays open so we can answer permission questions; it's closed on "result".
      const write = (msg: unknown) => {
        if (!child.stdin.writableEnded) child.stdin.write(JSON.stringify(msg) + "\n");
      };
      write({ type: "user", message: { role: "user", content } });
      const asked = new Set<string>(); // questions still waiting on you
      o.signal.addEventListener("abort", () => {
        for (const id of asked) settle(id, "deny");
        child.kill("SIGTERM");
      });

      const blocks: Block[] = [];
      let sessionId = o.sessionId;
      let buf = "";
      let stderr = "";
      let streamed = false; // did this message's text arrive as deltas?

      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          try {
            handle(JSON.parse(line));
          } catch {}
        }
      });

      // The CLI asks before running a tool that needs approval. Show it in Lens and wait.
      async function askPermission(ev: any) {
        const r = ev.request;
        const id: string = ev.request_id;
        asked.add(id);
        send({
          type: "permission",
          id,
          tool: r.display_name ?? r.tool_name,
          input: r.input,
          description: r.description ?? null,
          reason: r.decision_reason ?? null,
          canRemember: Array.isArray(r.permission_suggestions) && r.permission_suggestions.length > 0,
        });
        const d: Decision = await waitForDecision(id);
        asked.delete(id);
        send({ type: "permission_done", id, decision: d });
        const response =
          d === "deny"
            ? { behavior: "deny", message: "The user denied this in Claude Lens." }
            : {
                behavior: "allow",
                updatedInput: r.input,
                // "Always": save the CLI's own suggested rule (same as choosing "always" in the terminal).
                ...(d === "always" && r.permission_suggestions ? { updatedPermissions: r.permission_suggestions } : {}),
              };
        write({ type: "control_response", response: { subtype: "success", request_id: id, response } });
      }

      function handle(ev: any) {
        if (ev.type === "control_request") {
          if (ev.request?.subtype === "can_use_tool") void askPermission(ev);
          // Anything else we don't support: say so, rather than leave the CLI waiting.
          else write({ type: "control_response", response: { subtype: "error", request_id: ev.request_id, error: "Not supported by Claude Lens" } });
          return;
        }
        if (ev.type === "result") child.stdin.end(); // the turn is over; let the CLI exit
        recordEvent(ev); // keeps the plan usage and context window sizes current
        if (ev.session_id && ev.session_id !== sessionId) {
          sessionId = ev.session_id;
          send({ type: "session", claudeSessionId: ev.session_id });
          o.onSession?.(ev.session_id);
        }
        if (ev.type === "stream_event") {
          const d = ev.event?.delta;
          if (ev.event?.type === "content_block_delta" && d?.type === "text_delta") {
            streamed = true;
            send({ type: "delta", text: d.text });
          }
          return;
        }
        const content = ev.message?.content;
        if (!Array.isArray(content)) return;
        const wasStreamed = streamed;
        streamed = false;
        for (const c of content) {
          if (ev.type === "assistant" && c.type === "text" && c.text) {
            blocks.push({ kind: "text", text: c.text });
            // Slash command output (e.g. /context) comes whole, not as deltas.
            if (!wasStreamed) send({ type: "delta", text: c.text });
          } else if (ev.type === "assistant" && c.type === "tool_use") {
            blocks.push({ kind: "tool_use", id: c.id, name: c.name, input: c.input });
            send({ type: "tool", id: c.id, name: c.name, input: c.input });
          } else if (ev.type === "user" && c.type === "tool_result") {
            const text =
              typeof c.content === "string"
                ? c.content
                : Array.isArray(c.content)
                  ? c.content.map((x: any) => x.text ?? "").join("\n")
                  : "";
            blocks.push({ kind: "tool_result", toolUseId: c.tool_use_id, text, isError: !!c.is_error });
            send({ type: "tool_result", toolUseId: c.tool_use_id, text, isError: !!c.is_error });
          }
        }
      }

      child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));

      child.on("error", (err) => {
        send({ type: "error", error: `Could not start claude: ${err.message}` });
        close();
      });

      child.on("close", async (code) => {
        for (const id of asked) settle(id, "deny"); // the run ended; drop open questions
        if (!blocks.some((b) => b.kind === "text") && code !== 0) {
          send({ type: "error", error: stderr.trim() || `claude exited with code ${code}` });
          return close();
        }
        send({ type: "done", message: await o.onFinish(blocks, sessionId) });
        close();
      });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}

// Runs one `claude -p` turn to completion and returns the reply text. For short
// jobs whose answer the server needs (a handoff note, /compact), not for chat.
export function runClaudeOnce(o: { prompt: string; args: string[]; cwd: string | null; timeoutMs?: number }): Promise<{ ok: boolean; text: string; error?: string }> {
  const cwd = o.cwd && fs.existsSync(o.cwd) ? o.cwd : os.homedir();
  const env = { ...process.env };
  delete env.CLAUDECODE;
  return new Promise((resolve) => {
    const child = spawn("claude", ["-p", "--output-format", "stream-json", "--verbose", ...o.args], { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
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
