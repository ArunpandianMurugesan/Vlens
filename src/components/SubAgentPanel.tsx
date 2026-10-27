"use client";

import { CornerDownRight, Layers, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type { ToolRun, TreeChat } from "@/hooks/useTreeChat";
import type { ImageInput, SubThread } from "@/lib/types";
import { Composer } from "./Composer";
import { liveMessage, MessageBubble } from "./MessageBubble";
import { TerminalConsole } from "./TerminalConsole";

const QUICK = ["Explain this simply", "Show me where this is in the code", "Why is it done this way?", "What could go wrong here?"];

interface Props {
  thread: SubThread;
  depth: number;
  chat: TreeChat;
}

export function SubAgentPanel({ thread, depth, chat }: Props) {
  const live = chat.live[thread.id];
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const active = new Set(chat.stack);
  const running = !!live && !live.error;

  useEffect(() => {
    if (thread.messages.length === 0) inputRef.current?.focus();
  }, [thread.messages.length]);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.messages.length, live?.text.length, live?.tools.length]);

  const runs = useMemo(() => {
    const out: ToolRun[] = [];
    for (const m of thread.messages) {
      const results = new Map(
        m.blocks.flatMap((b) => (b.kind === "tool_result" ? [[b.toolUseId, b] as const] : [])),
      );
      for (const b of m.blocks)
        if (b.kind === "tool_use") {
          const r = results.get(b.id);
          out.push({ id: b.id, name: b.name, input: b.input, result: r && { text: r.text, isError: r.isError } });
        }
    }
    return live ? [...out, ...live.tools] : out;
  }, [thread.messages, live]);

  const submit = (text: string, images: ImageInput[] = []) => {
    if (!running) chat.send(thread.id, text, images);
  };

  return (
    <div className="flex h-full flex-col bg-panel">
      <header className="border-b border-line px-4 pb-3 pt-3">
        <div className="flex items-center gap-2 text-xs text-muted">
          <Layers size={13} className="text-accent" />
          <span className="font-medium text-accent">Sub-agent</span>
          <span>· level {depth}</span>
          <button
            onClick={() => chat.closeFrom(thread.id)}
            className="ml-auto rounded-md p-1 hover:bg-sunken hover:text-ink"
            aria-label="Close panel"
          >
            <X size={16} />
          </button>
        </div>
        <blockquote className="mt-2 line-clamp-3 border-l-2 border-accent pl-3 text-sm text-muted">
          {thread.selectedContextText}
        </blockquote>
      </header>

      <div ref={scroller} className="flex-1 space-y-5 overflow-y-auto px-4 py-4 scroll-thin">
        {thread.messages.length === 0 && !live && (
          <div className="space-y-2">
            <p className="text-sm text-muted">Ask anything about this snippet. The agent can read files in this project, but won’t change them.</p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map((q) => (
                <button
                  key={q}
                  onClick={() => submit(q)}
                  className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
                >
                  <CornerDownRight size={11} />
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {thread.messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            ctx={thread.id}
            compact
            childThreads={chat.threadsFrom(thread.id, m.id)}
            activeThreadIds={active}
            onOpenThread={chat.openThread}
          />
        ))}
        {live && (
          <MessageBubble
            message={liveMessage(live, thread.messages.at(-1)?.id ?? "")}
            ctx="live"
            compact
            streaming={running}
          />
        )}
        {running && !live.text && live.tools.length === 0 && (
          <div className="text-sm text-muted">Starting Claude…</div>
        )}
        {live?.error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">{live.error}</div>
        )}
      </div>

      <div className="px-3 pb-3 pt-1">
        <Composer
          inputRef={inputRef}
          placeholder={thread.messages.length ? "Follow up…" : "Ask about this snippet…"}
          running={running}
          onSend={submit}
          onStop={() => chat.stop(thread.id)}
          cwd={thread.cwd}
        />
      </div>

      <TerminalConsole runs={runs} running={running} />
    </div>
  );
}
