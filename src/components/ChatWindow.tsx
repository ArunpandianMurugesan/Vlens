"use client";

import { Check, Copy, Eye, FolderOpen, Loader2, Menu, Pencil } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ROOT, type RootMode, type TreeChat } from "@/hooks/useTreeChat";
import { MODELS } from "@/lib/models";
import { Composer } from "./Composer";
import { CwdContext } from "./FileContext";
import { FolderPicker } from "./FolderPicker";
import { liveMessage, MessageBubble } from "./MessageBubble";
import { PermissionCard } from "./PermissionCard";
import { ContextBadge } from "./Usage";

export function ChatWindow({ chat, onMenu }: { chat: TreeChat; onMenu: () => void }) {
  const { session, loadingSession, stack, threadsFrom, openThread, rootPending, draft } = chat;
  const newDraft = !session ? draft : null; // starting a new session, not yet created
  // Folders of existing sessions, most recent first, for the folder picker.
  const recent = useMemo(
    () => [...new Set(chat.sessions.map((s) => s.cwd).filter((c): c is string => !!c))],
    [chat.sessions],
  );
  const [mode, setMode] = useState<RootMode>("acceptEdits");
  // Per-message model; null = use the default from Settings.
  const [model, setModel] = useState<string | null>(null);
  const currentModel = model ?? chat.settings?.defaultModel ?? "";
  const run = chat.live[ROOT];
  const replying = !!run && !run.error;
  // While replying, show the session as it was plus the live stream (see rootPending in the hook).
  const shown = session ? (rootPending ? session.messages.slice(0, rootPending.base) : session.messages) : [];
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
  }, [session?.messages.length, session?.id, rootPending, run?.text.length, run?.tools.length]);

  const updated = session ? new Date(session.updatedAt).getTime() : 0;
  const own = chat.ownWrite;
  const ours = !!session && own?.id === session.id && updated <= own.at + 2000;
  const live = session && !rootPending && !ours && Date.now() - updated < 60_000;
  const resumeCmd = session ? `claude --resume ${session.id}` : "";

  return (
    <CwdContext.Provider value={session?.cwd ?? newDraft?.cwd ?? null}>
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
        ) : newDraft ? (
          <div className="min-w-0 flex-1">
            <h1 className="font-medium">New session</h1>
            {newDraft.cwd && (
              <div className="flex items-center gap-1.5 truncate text-xs text-muted">
                <FolderOpen size={11} className="shrink-0" />
                <span className="truncate">{newDraft.cwd}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 text-muted">{loadingSession ? "Loading…" : "Claude Lens"}</div>
        )}
        {session && <ContextBadge ctx={session.context} />}
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
        {newDraft && !rootPending && (
          <div className="mx-auto max-w-2xl px-4 py-8">
            <h2 className="mb-1 text-xl font-semibold">Start a new session</h2>
            <p className="mb-6 text-sm text-muted">Pick the folder Claude should work in, then type your first message below.</p>
            <FolderPicker value={newDraft.cwd} onChange={(cwd) => chat.setDraft({ cwd })} recent={recent} />
          </div>
        )}
        {!session && loadingSession && (
          <div className="flex h-full items-center justify-center text-muted">
            <Loader2 className="animate-spin" />
          </div>
        )}
        {(session || rootPending) && (
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
            {shown.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                ctx="root"
                childThreads={threadsFrom(null, m.id)}
                activeThreadIds={active}
                onOpenThread={openThread}
              />
            ))}
            {rootPending && <MessageBubble message={rootPending.message} ctx="live" />}
            {run && (
              <MessageBubble
                message={liveMessage(run, rootPending?.message.id ?? "", "assistant")}
                ctx="live"
                streaming={replying}
              />
            )}
            {run?.asks?.map((a) => (
              <div key={a.id} className="pl-10">
                <PermissionCard ask={a} />
              </div>
            ))}
            {replying && !run.text && run.tools.length === 0 && <div className="pl-10 text-sm text-muted">Starting Claude…</div>}
            {run?.error && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-600">{run.error}</div>
            )}
          </div>
        )}
      </div>

      {(session || newDraft) && (
        <div className={`px-4 pb-4 pt-2 transition-[padding] duration-300 ${stack.length ? "xl:pr-[556px]" : ""}`}>
          <div className="mx-auto max-w-3xl">
            {live && (
              <p className="mb-2 text-xs text-amber-600">
                This session changed in the last minute. If it&apos;s open in a terminal, send from there instead.
              </p>
            )}
            <Composer
              placeholder={
                session
                  ? "Reply…  type / for commands, paste images, select text to ask a sub-agent"
                  : newDraft?.cwd
                    ? "What should Claude do in this folder?"
                    : "Pick a folder first"
              }
              disabled={!session && !newDraft?.cwd}
              running={replying}
              onSend={(t, imgs) => chat.sendRoot(t, mode, currentModel, imgs)}
              cwd={session?.cwd ?? newDraft?.cwd ?? null}
              onStop={() => chat.stop(ROOT)}
              footer={
                <div className="flex flex-wrap items-center gap-2">
                  <ModeToggle mode={mode} onChange={setMode} />
                  <select
                    value={currentModel}
                    onChange={(e) => setModel(e.target.value)}
                    aria-label="Model for this message"
                    title="Model for this message (default is set in Settings)"
                    className="rounded-lg bg-sunken px-1.5 py-0.5 text-[0.7rem] text-muted outline-none hover:text-ink"
                  >
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
              }
            />
          </div>
        </div>
      )}
    </main>
    </CwdContext.Provider>
  );
}

function ModeToggle({ mode, onChange }: { mode: RootMode; onChange: (m: RootMode) => void }) {
  const opts = [
    { id: "acceptEdits" as const, label: "Can edit files", icon: Pencil },
    { id: "plan" as const, label: "Read-only", icon: Eye },
  ];
  return (
    <div className="flex w-fit rounded-lg bg-sunken p-0.5 text-[0.7rem]">
      {opts.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`flex items-center gap-1 rounded-md px-2 py-0.5 transition ${
            mode === o.id ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
        >
          <o.icon size={11} />
          {o.label}
        </button>
      ))}
    </div>
  );
}
