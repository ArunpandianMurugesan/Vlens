/* eslint-disable @typescript-eslint/no-explicit-any -- parses untyped CLI JSON lines */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { getThread, updateStore } from "@/lib/threads";
import type { AgentEvent, Block, ChatMessage, SubThread } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface CreateThread {
  id: string;
  rootSessionId: string;
  parentThreadId: string | null;
  anchorMessageId: string;
  selectedContextText: string;
  parentMessageText: string;
  cwd: string | null;
}

interface Body {
  threadId?: string;
  create?: CreateThread;
  prompt: string;
}

const SYSTEM_PROMPT = `You are a focused sub-agent. The user selected a snippet from an earlier answer in a Claude Code session and wants to dig into just that snippet.
Stay strictly on the snippet. Be short and clear. You may read files in the working directory to ground your answer, but do not edit anything.`;

function firstPrompt(c: CreateThread, question: string) {
  return [
    `Context message the snippet came from:\n"""\n${c.parentMessageText.slice(0, 6000)}\n"""`,
    `Selected snippet:\n"""\n${c.selectedContextText}\n"""`,
    `Question about the snippet: ${question}`,
  ].join("\n\n");
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  if (!body.prompt?.trim()) return Response.json({ error: "prompt required" }, { status: 400 });

  let thread: SubThread | null = body.threadId ? await getThread(body.threadId) : null;
  if (!thread && !body.create) return Response.json({ error: "thread not found" }, { status: 404 });

  const isNew = !thread;
  if (!thread) {
    const c = body.create!;
    thread = {
      id: /^[0-9a-f-]{36}$/.test(c.id) ? c.id : randomUUID(),
      rootSessionId: c.rootSessionId,
      parentThreadId: c.parentThreadId,
      anchorMessageId: c.anchorMessageId,
      selectedContextText: c.selectedContextText,
      cwd: c.cwd,
      claudeSessionId: null,
      messages: [],
      createdAt: new Date().toISOString(),
    };
  }

  const userMsg: ChatMessage = {
    id: randomUUID(),
    parentId: thread.messages.at(-1)?.id ?? thread.anchorMessageId,
    role: "user",
    blocks: [{ kind: "text", text: body.prompt }],
    timestamp: new Date().toISOString(),
  };
  thread.messages.push(userMsg);
  const saved = thread;
  await updateStore((s) => void (s[saved.id] = saved));

  const prompt = isNew ? firstPrompt(body.create!, body.prompt) : body.prompt;
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    // Plan mode lets the sub-agent read and search but never change files.
    "--permission-mode",
    "plan",
  ];
  if (thread.claudeSessionId) args.push("--resume", thread.claudeSessionId);
  else args.push("--append-system-prompt", SYSTEM_PROMPT);

  const cwd = thread.cwd && fs.existsSync(thread.cwd) ? thread.cwd : os.homedir();
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
      send({ type: "thread", thread: saved });

      const child = spawn("claude", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      req.signal.addEventListener("abort", () => child.kill("SIGTERM"));

      const blocks: Block[] = [];
      let sessionId: string | null = saved.claudeSessionId;
      let buf = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          let ev: any;
          try {
            ev = JSON.parse(line);
          } catch {
            continue;
          }
          handle(ev);
        }
      });

      function handle(ev: any) {
        if (ev.session_id && ev.session_id !== sessionId) {
          sessionId = ev.session_id;
          send({ type: "session", claudeSessionId: ev.session_id });
          // Save right away so the sidebar hides this CLI session while it runs.
          const sid = ev.session_id;
          void updateStore((s) => {
            if (s[saved.id]) s[saved.id].claudeSessionId = sid;
          });
        }
        if (ev.type === "stream_event") {
          const d = ev.event?.delta;
          if (ev.event?.type === "content_block_delta" && d?.type === "text_delta") {
            send({ type: "delta", text: d.text });
          }
          return;
        }
        const content = ev.message?.content;
        if (!Array.isArray(content)) return;
        for (const c of content) {
          if (ev.type === "assistant" && c.type === "text" && c.text) {
            blocks.push({ kind: "text", text: c.text });
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
        controller.close();
      });

      child.on("close", async (code) => {
        if (!blocks.some((b) => b.kind === "text") && code !== 0) {
          send({ type: "error", error: stderr.trim() || `claude exited with code ${code}` });
          try {
            controller.close();
          } catch {}
          return;
        }
        const reply: ChatMessage = {
          id: randomUUID(),
          parentId: userMsg.id,
          role: "sub-agent",
          blocks,
          timestamp: new Date().toISOString(),
        };
        await updateStore((s) => {
          const t = s[saved.id];
          if (!t) return;
          t.messages.push(reply);
          t.claudeSessionId = sessionId;
        });
        send({ type: "done", message: reply });
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}
