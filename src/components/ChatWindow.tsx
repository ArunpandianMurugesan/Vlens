"use client";

import { Check, Clock, Copy, Eye, FolderOpen, Loader2, Menu, Pencil, Power, ShieldCheck, ShieldOff, Sparkles, SquareTerminal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ROOT, type RootMode, type TreeChat } from "@/hooks/useTreeChat";
import { PERMISSION_MODES } from "@/lib/modes";
import { MODELS } from "@/lib/models";
import type { ImageInput } from "@/lib/types";
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
  // Starts in the mode your terminal claude starts in (permissions.defaultMode), until you pick one.
  const [pickedMode, setMode] = useState<RootMode | null>(null);
  const mode = pickedMode ?? chat.settings?.cliMode ?? "default";
  const cycleMode = () => setMode(PERMISSION_MODES[(PERMISSION_MODES.findIndex((m) => m.id === mode) + 1) % PERMISSION_MODES.length].id);
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
  // Open in a terminal or the desktop app (not one of Vlens's own runs)? That claude
  // holds the conversation in memory, so only one place can type at a time.
  const proc = chat.sessions.find((s) => s.id === session?.id)?.active;
  const elsewhere = proc && !proc.byLens ? proc.entrypoint : null;
  // Messages you send while Claude works wait here and go out together when it's
  // done, like typing ahead in the terminal. Stopping (or an error) pauses them.
  const [queue, setQueue] = useState<{ text: string; images: ImageInput[] }[]>([]);
  const [paused, setPaused] = useState(false);
  const lastSession = useRef(session?.id);
  useEffect(() => {
    // A new session getting its id keeps the queue; switching to another session drops it.
    if (lastSession.current && session?.id !== lastSession.current) {
      setQueue([]);
      setPaused(false);
    }
    lastSession.current = session?.id;
  }, [session?.id]);
  const send = (text: string, images: ImageInput[]) => {
    const all = [...queue, { text, images }];
    setQueue([]);
    setPaused(false);
    void chat.sendRoot(all.map((q) => q.text).filter(Boolean).join("\n\n"), mode, currentModel, all.flatMap((q) => q.images));
  };
  const failed = !!run?.error;
  useEffect(() => {
    if (replying || paused || failed || !queue.length) return;
    const all = queue;
    setQueue([]);
    void chat.sendRoot(all.map((q) => q.text).filter(Boolean).join("\n\n"), mode, currentModel, all.flatMap((q) => q.images));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- send once the run ends, with the mode and model picked then
  }, [replying, paused, failed, queue.length]);

  const [handoff, setHandoff] = useState<"idle" | "confirm" | "busy">("idle");
  const [handoffErr, setHandoffErr] = useState<string | null>(null);
  useEffect(() => {
    setHandoff("idle");
    setHandoffErr(null);
  }, [session?.id, elsewhere]);
  const takeOver = async () => {
    if (!session) return;
    setHandoff("busy");
    try {
      await chat.endSession(session.id); // stops that claude; the conversation is kept
    } catch (e) {
      setHandoffErr((e as Error).message);
    }
    setHandoff("idle");
  };
  const toTerminal = async () => {
    if (!session) return;
    setHandoffErr(null);
    const res = await fetch(`/api/sessions/${session.id}/terminal`, { method: "POST" });
    if (!res.ok) setHandoffErr((await res.json().catch(() => null))?.error ?? "Couldn't open the terminal.");
  };

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
          <div className="flex-1 text-muted">{loadingSession ? "Loading…" : "Vlens"}</div>
        )}
        {session && <ContextBadge ctx={session.context} />}
        {session && !elsewhere && (
          <button
            onClick={toTerminal}
            disabled={replying}
            title="Open this session in Terminal (claude --resume) and keep going there"
            className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-ink disabled:opacity-50 sm:flex"
          >
            <SquareTerminal size={12} /> Continue in terminal
          </button>
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
          <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
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
                <PermissionCard ask={a} onMode={setMode} />
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
          <div className="mx-auto max-w-5xl">
            {handoffErr && <p className="mb-2 text-xs text-red-600">{handoffErr}</p>}
            {elsewhere ? (
              // Typing here wouldn't reach that claude, so hand over explicitly instead.
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3 text-sm">
                <SquareTerminal size={16} className="shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">Open in {elsewhere === "desktop" ? "the Claude desktop app" : "a terminal"}</div>
                  <div className="text-xs text-muted">
                    Type there (and answer Claude&apos;s questions there); Vlens shows it here as it happens.
                    {elsewhere === "cli" && " To continue in Vlens instead, take it over: that ends the claude in the terminal, and its conversation is kept."}
                  </div>
                </div>
                {elsewhere === "cli" &&
                  (handoff === "confirm" ? (
                    <span className="flex items-center gap-2 text-xs">
                      End the claude in that terminal?
                      <button onClick={takeOver} className="rounded-lg bg-accent px-2.5 py-1 font-medium text-white">Take over</button>
                      <button onClick={() => setHandoff("idle")} className="rounded-lg px-2 py-1 text-muted hover:text-ink">Cancel</button>
                    </span>
                  ) : (
                    <button
                      onClick={() => setHandoff("confirm")}
                      disabled={handoff === "busy"}
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      {handoff === "busy" ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />} Take over here
                    </button>
                  ))}
              </div>
            ) : (
            <>
            {live && (
              <p className="mb-2 text-xs text-amber-600">
                This session changed in the last minute. If it&apos;s open in a terminal, send from there instead.
              </p>
            )}
            {queue.length > 0 && (
              <div className="mb-2 space-y-1">
                {queue.map((q, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-dashed border-line bg-sunken/60 px-3 py-1.5 text-xs">
                    <Clock size={12} className="shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate">
                      {q.text || "(image)"}
                      {q.images.length > 0 && q.text && <span className="text-muted"> + {q.images.length} image{q.images.length > 1 ? "s" : ""}</span>}
                    </span>
                    <button onClick={() => setQueue((all) => all.filter((_, j) => j !== i))} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Remove queued message">
                      <X size={12} />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2 px-1 text-[0.7rem] text-muted">
                  {paused || failed ? (
                    <>
                      Paused, since the reply {failed ? "failed" : "was stopped"}.
                      <button onClick={() => (replying ? setPaused(false) : send("", []))} className="text-accent hover:underline">
                        Send now
                      </button>
                    </>
                  ) : (
                    "Queued: sends when Claude is done."
                  )}
                </div>
              </div>
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
              onSend={send}
              onQueue={(text, images) => setQueue((q) => [...q, { text, images }])}
              onShiftTab={cycleMode}
              cwd={session?.cwd ?? newDraft?.cwd ?? null}
              onStop={() => {
                if (queue.length) setPaused(true); // like Esc in the terminal: don't fire the queued messages
                chat.stop(ROOT);
              }}
              footer={
                <div className="flex flex-wrap items-center gap-2">
                  <ModePicker mode={mode} cliMode={chat.settings?.cliMode} onChange={setMode} />
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
            </>
            )}
          </div>
        </div>
      )}
    </main>
    </CwdContext.Provider>
  );
}

// The permission mode for your next messages. Shift+Tab in the message box cycles it, like the terminal.
function ModePicker({ mode, cliMode, onChange }: { mode: RootMode; cliMode?: RootMode; onChange: (m: RootMode) => void }) {
  const cur = PERMISSION_MODES.find((m) => m.id === mode)!;
  const Icon = mode === "plan" ? Eye : mode === "bypassPermissions" ? ShieldOff : mode === "auto" ? Sparkles : mode === "acceptEdits" ? Pencil : ShieldCheck;
  return (
    <label
      title={`${cur.hint}. Shift+Tab in the message box switches modes.`}
      className={`flex items-center gap-1 rounded-lg bg-sunken px-1.5 py-0.5 text-[0.7rem] ${mode === "bypassPermissions" ? "text-red-600" : mode === "default" ? "text-muted" : "text-accent"}`}
    >
      <Icon size={11} className="shrink-0" />
      <select value={mode} onChange={(e) => onChange(e.target.value as RootMode)} aria-label="Permission mode" className="bg-transparent outline-none">
        {PERMISSION_MODES.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
            {m.id === cliMode ? " (your CLI default)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
