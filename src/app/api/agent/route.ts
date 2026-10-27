import { randomUUID } from "node:crypto";
import { imageBlocks, parseImages } from "@/lib/images";
import { modelArgs } from "@/lib/models";
import { streamClaude } from "@/lib/runClaude";
import { lensPluginArgs } from "@/lib/lensPlugin";
import { getSettings } from "@/lib/settings";
import { getThread, updateStore } from "@/lib/threads";
import type { ChatMessage, SubThread } from "@/lib/types";

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
  images?: unknown;
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
  const parsed = parseImages(body.images);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const { images } = parsed;
  if (!body.prompt?.trim() && !images.length) return Response.json({ error: "prompt required" }, { status: 400 });

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
    // Thread history is ours to keep, so store images inline to show them later.
    blocks: [{ kind: "text", text: body.prompt }, ...imageBlocks(images)],
    timestamp: new Date().toISOString(),
  };
  thread.messages.push(userMsg);
  const saved = thread;
  await updateStore((s) => void (s[saved.id] = saved));

  const settings = await getSettings();
  return streamClaude({
    prompt: isNew ? firstPrompt(body.create!, body.prompt) : body.prompt,
    images,
    // Plan mode lets the sub-agent read and search but never change files.
    args: [
      "--permission-mode",
      "plan",
      ...modelArgs(settings.subAgentModel || settings.defaultModel),
      ...(await lensPluginArgs(settings)),
      ...(saved.claudeSessionId ? ["--resume", saved.claudeSessionId] : ["--append-system-prompt", SYSTEM_PROMPT]),
    ],
    cwd: saved.cwd,
    signal: req.signal,
    sessionId: saved.claudeSessionId,
    first: { type: "thread", thread: saved },
    // Save right away so the sidebar hides this CLI session while it runs.
    onSession: (sid) =>
      void updateStore((s) => {
        if (s[saved.id]) s[saved.id].claudeSessionId = sid;
      }),
    onFinish: async (blocks, sessionId) => {
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
      return reply;
    },
  });
}
