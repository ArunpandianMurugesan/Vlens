"use client";

import { Check, Copy, FolderOpen, Loader2, Menu, MousePointerClick } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TreeChat } from "@/hooks/useTreeChat";
import { MessageBubble } from "./MessageBubble";

export function ChatWindow({ chat, onMenu }: { chat: TreeChat; onMenu: () => void }) {
  const { session, loadingSession, stack, threadsFrom, openThread } = chat;
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [copied, setCopied] = useState(false);
  const active = new Set(stack);

  // Jump to the latest message on open, then follow new ones only if already at the bottom.
  useEffect(() => {
    stickToBottom.current = true;
  }, [session?.id]);
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [session?.messages.length, session?.id]);

  const live = session && Date.now() - new Date(session.updatedAt).getTime() < 60_000;
  const resumeCmd = session ? `claude --resume ${session.id}` : "";

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-bg/80 px-4 py-3 backdrop-blur">
        <button onClick={onMenu} className="text-muted md:hidden" aria-label="Open sidebar">
          <Menu size={20} />
        </button>
        {session ? (
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-medium">{session.title}</h1>
              {live && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.68rem] font-medium text-emerald-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> live
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 truncate text-xs text-muted">
              <FolderOpen size={11} className="shrink-0" />
              <span className="truncate">{session.cwd ?? session.projectName}</span>
            </div>
          </div>
        ) : (
          <div className="flex-1 text-muted">{loadingSession ? "Loading…" : "Claude Lens"}</div>
        )}
        {session && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(resumeCmd);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            title={resumeCmd}
            className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-ink sm:flex"
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? "Copied" : "Resume in CLI"}
          </button>
        )}
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        }}
        // On wide screens, make room for the sub-agent panels instead of hiding under them.
        className={`flex-1 overflow-y-auto transition-[padding] duration-300 scroll-thin ${stack.length ? "xl:pr-[540px]" : ""}`}
      >
        {!session && !loadingSession && <Empty />}
        {!session && loadingSession && (
          <div className="flex h-full items-center justify-center text-muted">
            <Loader2 className="animate-spin" />
          </div>
        )}
        {session && (
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
            {session.messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                ctx="root"
                childThreads={threadsFrom(null, m.id)}
                activeThreadIds={active}
                onOpenThread={openThread}
              />
            ))}
          </div>
        )}
      </div>

      {session && (
        <div className="flex items-center justify-center gap-1.5 border-t border-line px-4 py-2.5 text-xs text-muted">
          <MousePointerClick size={13} />
          Select any text in an answer to ask a sub-agent about it
        </div>
      )}
    </main>
  );
}

function Empty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="text-2xl font-semibold">Your Claude Code sessions</div>
      <p className="max-w-md text-sm text-muted">
        Pick a session on the left. Select any part of an answer and click <b>Ask Sub-Agent</b> to open a focused
        side thread. You can nest them as deep as you like.
      </p>
    </div>
  );
}
