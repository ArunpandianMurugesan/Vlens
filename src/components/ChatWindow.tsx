"use client";

import { Archive, Check, ChevronDown, Clock, Copy, Eye, GitFork, Loader2, MessageSquare, PanelRight, Pencil, Power, ShieldCheck, ShieldOff, Sparkles, SquareTerminal, Terminal, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type LiveRun, type RootMode, type TreeChat } from "@/hooks/useTreeChat";
import { PERMISSION_MODES } from "@/lib/modes";
import { MODELS } from "@/lib/models";
import { type SlashUi, slashUi } from "@/lib/slash";
import type { ImageInput } from "@/lib/types";
import { Composer } from "./Composer";
import { CwdContext, useFiles } from "./FileContext";
import { FolderChip, lastFolder } from "./FolderChip";
import { useInspector } from "./Inspector";
import { forkSession, justForked } from "@/lib/fork";
import { useMenu } from "@/lib/menu";
import { liveMessage, MessageBubble } from "./MessageBubble";
import { PermissionCard } from "./PermissionCard";
import { RunActivity } from "./RunActivity";
import { SlashPanel } from "./SlashPanel";
import { lastWorktree, rememberWorktree, WorktreeToggle } from "./WorktreeToggle";
import { ContextBadge } from "./Usage";
import { MenuButton } from "./Sidebar";
import { CliPane, cliEndedRecently, startCli, stopCli, useCliOn } from "./TerminalPanel";

// botMode: this is a chat with a bot, which always runs in its own mode (set in its settings).
export function ChatWindow({ chat, onMenu, botMode }: { chat: TreeChat; onMenu: () => void; botMode?: RootMode | "" }) {
  const { session, loadingSession, stack, threadsFrom, openThread, rootPending, draft } = chat;
  const newDraft = !session ? draft : null; // starting a new session, not yet created
  const files = useFiles();
  // The session's CLI view (claude --resume in place of the chat). Chat is the default;
  // only one of the two drives the session at a time.
  const cli = useCliOn(session?.id ?? null) && botMode === undefined;
  const [inspector, setInspector] = useInspector();
  // The inspector is beside the chat (wide window, nothing else open there).
  const inspectorShown = botMode === undefined && inspector && !files?.tabs.length && !files?.terminal;
  // Folders of existing sessions, most recent first, for the folder picker.
  const recent = useMemo(
    () => [...new Set(chat.sessions.filter((s) => !s.botId).map((s) => s.cwd).filter((c): c is string => !!c))],
    [chat.sessions],
  );
  // A new session starts in the folder you used last (or your latest one); the chip changes it.
  const setDraftFolder = (cwd: string) => chat.setDraft({ cwd, worktree: lastWorktree(cwd) });
  const draftOpen = !!newDraft;
  const draftCwd = newDraft?.cwd;
  useEffect(() => {
    if (!draftOpen || draftCwd) return;
    const start = lastFolder() || recent[0];
    if (start) setDraftFolder(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only to fill an empty draft
  }, [draftOpen, draftCwd, recent[0]]);
  // Starts in the mode your terminal claude starts in (permissions.defaultMode), until you pick one.
  const [pickedMode, setMode] = useState<RootMode | null>(null);
  const mode = (botMode || null) ?? pickedMode ?? chat.settings?.cliMode ?? "default";
  const cycleMode = () => setMode(PERMISSION_MODES[(PERMISSION_MODES.findIndex((m) => m.id === mode) + 1) % PERMISSION_MODES.length].id);
  // Per-message model; null = use the default from Settings.
  const [model, setModel] = useState<string | null>(null);
  const currentModel = model ?? chat.settings?.defaultModel ?? "";
  const run = rootPending ? chat.live[rootPending.runId] : undefined;
  const replying = !!run && !run.error;
  const sid = chat.viewSessionId;
  const stopTask = sid ? (taskId: string) => chat.stopTask(sid, taskId).catch(() => {}) : undefined;
  // The open Claude's background work between replies, shaped like a live run.
  const bg = useMemo<LiveRun | null>(() => {
    const l = chat.liveState;
    if (!l || (!l.busy && !l.tasks.length && !l.asks.length)) return null;
    return { text: "", tools: [], status: l.status ?? undefined, tasks: Object.fromEntries(l.tasks.map((t) => [t.id, t])) };
  }, [chat.liveState]);
  // While replying, show the session as it was plus the live stream (see rootPending in the hook).
  const shown = session ? (rootPending ? session.messages.slice(0, rootPending.base) : session.messages) : [];
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [copied, setCopied] = useState(false);
  const active = new Set(stack);

  // Jump to the latest message on open, then follow new ones only if already at the bottom.
  useEffect(() => {
    stickToBottom.current = true;
  }, [session?.id, cli]);
  useEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [session?.messages.length, session?.id, rootPending, run?.text.length, run?.tools.length, cli]);

  const updated = session ? new Date(session.updatedAt).getTime() : 0;
  const own = chat.ownWrite;
  const ours = !!session && own?.id === session.id && updated <= own.at + 2000;
  // Open in a terminal or the desktop app (not one of Vlens's own runs)? That claude
  // holds the conversation in memory, so only one place can type at a time.
  const proc = chat.sessions.find((s) => s.id === session?.id)?.active;
  // Our own CLI shows up as "a terminal" until the next sessions refresh after it ends.
  const ownCli = cli || cliEndedRecently(session?.id ?? null);
  const elsewhere = proc && !proc.byLens && !ownCli ? proc.entrypoint : null;
  // Your own CLI view writing to it isn't "something else" either.
  const live = session && !justForked(session.id) && !ownCli && !rootPending && !ours && !chat.liveState && !proc?.byLens && Date.now() - updated < 60_000;
  const toChat = async () => {
    if (!session) return;
    await stopCli(session.id);
  };
  const toCli = () => session && startCli(session.id, session.cwd);
  const archivedAt = chat.sessions.find((s) => s.id === session?.id)?.archivedAt;
  // Changed by something else just now. Vlens's own Claude writes between replies
  // too (when background work reports back), and that's not "something else".
  // A fork you just made was written by Vlens, not by something else.
  const resumeCmd = session ? `claude --resume ${session.id}` : "";
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
  // "/model", "/config", … open Vlens's own menu: Claude here has no screen for them.
  const [slash, setSlash] = useState<SlashUi | null>(null);
  const picked = (text: string, images: ImageInput[]) => {
    const ui = images.length ? null : slashUi(text);
    if (ui) setSlash(ui);
    return !!ui;
  };
  useEffect(() => setSlash(null), [session?.id]);
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

  // Fork: a copy of this session with its whole history (the original stays as it is).
  const [forking, setForking] = useState<"menu" | "busy" | null>(null);
  const fork = async (terminal: boolean) => {
    if (!session) return;
    setForking("busy");
    setHandoffErr(null);
    try {
      const r = await forkSession(session.id, terminal);
      if (r.id) chat.selectSession(r.id);
    } catch (e) {
      setHandoffErr((e as Error).message);
    }
    setForking(null);
  };

  // The Mac menus' Session items (bot chats too, except the ones about terminals).
  useMenu({
    fork: () => botMode === undefined && void fork(false),
    "fork-terminal": () => botMode === undefined && void fork(true),
    "next-mode": () => botMode === undefined && cycleMode(),
    stop: () => {
      if (rootPending) chat.stop(rootPending.runId);
      else if (chat.liveState?.busy) void chat.stopLive();
    },
    compact: () => {
      if (!session) return;
      if (elsewhere) return window.alert(`This session is open in ${elsewhere}. Use /compact there.`);
      void fetch(`/api/sessions/${session.id}/context`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "compact" }) })
        .then((r) => r.json())
        .then((d) => d.error && window.alert(d.error));
    },
    "to-terminal": () => botMode === undefined && !elsewhere && void toTerminal(),
    "take-over": () => elsewhere && void takeOver(),
  });

  return (
    <CwdContext.Provider value={session?.cwd ?? newDraft?.cwd ?? null}>
    <main className="@container/chat flex min-w-0 flex-1 flex-col">
      {/* A bot chat has the bot's own header instead (BotsView). Its terminal buttons would
          also run it as plain claude, without its setup tools or connector blocks. */}
      {botMode === undefined && (
      <header className="@container flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/80 px-4 backdrop-blur">
        <MenuButton onClick={onMenu} />
        {session ? (
          <div className="min-w-[6rem] flex-1">
            <div className="flex items-center gap-2">
              <h1 className="truncate text-sm font-semibold">{session.title}</h1>
              {live && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.68rem] font-medium text-emerald-600">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> live
                </span>
              )}
            </div>
            {/* folder · branch · model, like the design */}
            <div className="truncate text-[0.7rem] text-muted" title={session.cwd ?? undefined}>
              {[session.projectName, session.branch !== "HEAD" ? session.branch : null, prettyModel(session.context?.model ?? null)].filter(Boolean).join(" · ")}
            </div>
          </div>
        ) : newDraft ? (
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-semibold">New session</h1>
            {newDraft.cwd && <div className="truncate text-[0.7rem] text-muted">{newDraft.cwd.replace(/^\/Users\/[^/]+/, "~")}</div>}
          </div>
        ) : (
          <div className="flex-1 text-muted">{loadingSession ? "Loading…" : "Vlens"}</div>
        )}
        {session && botMode === undefined && (
          <div role="group" aria-label="Interface" className="flex shrink-0 rounded-lg bg-sunken p-0.5 text-xs">
            <button
              onClick={() => cli && void toChat()}
              aria-pressed={!cli}
              title={cli ? "Back to the chat (ends the claude in the CLI view; the conversation is kept)" : "Chat view"}
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 ${!cli ? "bg-bg text-ink shadow-sm" : "text-muted hover:text-ink"}`}
            >
              <MessageSquare size={12} /> <span className="hidden @4xl:inline">Chat</span>
            </button>
            <button
              onClick={() => !cli && toCli()}
              disabled={!cli && (replying || !!elsewhere)}
              aria-pressed={cli}
              title={
                cli
                  ? "CLI view: the real claude for this session"
                  : elsewhere
                    ? `Open in ${elsewhere === "desktop" ? "the desktop app" : "a terminal"} already`
                    : replying
                      ? "Wait for the reply to finish"
                      : "Switch to the real claude CLI for this session (claude --resume)"
              }
              className={`flex items-center gap-1 rounded-md px-2 py-0.5 disabled:opacity-40 ${cli ? "bg-bg text-ink shadow-sm" : "text-muted hover:text-ink"}`}
            >
              <Terminal size={12} /> <span className="hidden @4xl:inline">CLI</span>
            </button>
          </div>
        )}
        {/* The inspector shows context and the terminal on a wide window; these are for narrower ones. */}
        {session && (
          <span className={inspectorShown ? "xl:hidden" : ""}>
            <ContextBadge ctx={session.context} />
          </span>
        )}
        {(session || newDraft?.cwd) && files && (
          <button
            onClick={() => files.setTerminal((t) => !t)}
            title="A shell in this session's folder, beside the chat (Ctrl+`)"
            aria-pressed={files.terminal}
            className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs hover:text-ink ${inspectorShown ? "xl:hidden" : ""} ${
              files.terminal ? "border-accent bg-accent-soft text-accent" : "border-line text-muted"
            }`}
          >
            <Terminal size={12} /> <span className="hidden @4xl:inline">Terminal</span>
          </button>
        )}
        {(session || newDraft?.cwd) && !elsewhere && !cli && <ModePicker mode={mode} cliMode={chat.settings?.cliMode} onChange={setMode} header />}
        {/* Continue in Terminal.app lives in the Session menu and ⌘K; the CLI toggle covers it here. */}
        {session && session.messages.length > 0 && (
          <div className="relative hidden sm:block">
            <button
              onClick={() => setForking((f) => (f === "menu" ? null : "menu"))}
              disabled={forking === "busy"}
              title="Fork: a copy of this conversation to try another way (the original stays as it is)"
              aria-haspopup="menu"
              aria-expanded={forking === "menu"}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:text-ink disabled:opacity-50"
            >
              {forking === "busy" ? <Loader2 size={12} className="animate-spin" /> : <GitFork size={12} />} <span className="hidden @4xl:inline">Fork</span> <ChevronDown size={11} />
            </button>
            {forking === "menu" && (
              <div role="menu" className="absolute right-0 top-8 z-40 w-60 rounded-xl border border-line bg-panel py-1 text-sm shadow-xl" onMouseLeave={() => setForking(null)}>
                <button role="menuitem" onClick={() => void fork(false)} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-sunken">
                  <GitFork size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Fork here <span className="text-[0.7rem] text-muted">⇧⌘F</span>
                    <span className="block text-xs text-muted">A copy opens in Vlens: &ldquo;{session.title.slice(0, 28)} ↳&rdquo;</span>
                  </span>
                </button>
                <button role="menuitem" onClick={() => void fork(true)} className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-sunken">
                  <SquareTerminal size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Fork in Terminal
                    <span className="block text-xs text-muted">claude --resume … --fork-session</span>
                  </span>
                </button>
              </div>
            )}
          </div>
        )}
        {session && (
          <button
            onClick={() => {
              navigator.clipboard.writeText(resumeCmd);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            title={`Copy: ${resumeCmd}`}
            aria-label="Copy the resume command"
            className="hidden shrink-0 rounded-lg border border-line p-1.5 text-muted hover:text-ink @lg:block"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        )}
        {session && !files?.tabs.length && !files?.terminal && (
          <button
            onClick={() => setInspector(!inspector)}
            aria-pressed={inspector}
            aria-label="Toggle inspector"
            title="Context, files changed, plan usage and terminal, beside the chat (⌥⌘I)"
            className={`hidden shrink-0 rounded-lg p-1.5 xl:block ${inspector ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink"}`}
          >
            <PanelRight size={14} />
          </button>
        )}
      </header>
      )}

      {cli && session ? (
        <CliPane sessionId={session.id} cwd={session.cwd} />
      ) : (
      <>
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
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center px-4 text-center">
            <h2 className="mb-1 text-xl font-semibold">New session</h2>
            <p className="text-sm text-muted">
              {newDraft.cwd ? (
                <>
                  Claude will work in <span className="font-mono text-ink">{newDraft.cwd.replace(/^\/Users\/[^/]+/, "~")}</span>. Change it with the folder button below.
                </>
              ) : (
                "Pick the folder Claude works in with the folder button below, then type your first message."
              )}
            </p>
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
            {run && <RunActivity run={run} replying={replying} onStopTask={stopTask} />}
            {/* Between replies: Claude's background work, and Claude telling itself it finished. */}
            {!rootPending && bg && (
              <>
                <RunActivity run={bg} replying={!!chat.liveState?.busy} onStop={chat.liveState?.busy ? () => void chat.stopLive() : undefined} onStopTask={stopTask} />
                {chat.liveState?.asks.map((a) => (
                  <div key={a.id} className="pl-10">
                    <PermissionCard ask={a} onMode={setMode} />
                  </div>
                ))}
              </>
            )}
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
            {archivedAt && !rootPending && (
              <div className="mb-2 flex items-center gap-2 px-1 text-xs text-muted">
                <Archive size={12} className="shrink-0" />
                Archived. Sending a message brings it back.
                <button onClick={() => void chat.archiveSession(session!.id, false)} className="text-accent hover:underline">
                  Unarchive
                </button>
              </div>
            )}
            {elsewhere ? (
              // Typing here wouldn't reach that claude, so hand over explicitly instead.
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3 text-sm">
                <SquareTerminal size={16} className="shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">Open in {elsewhere === "desktop" ? "the Claude desktop app" : "a terminal"}</div>
                  <div className="text-xs text-muted">
                    Type there (and answer Claude&apos;s questions there); Vlens shows it here as it happens.
                    {elsewhere === "cli"
                      ? " To continue in Vlens instead, take it over: that ends the claude in the terminal, and its conversation is kept."
                      : " To continue in Vlens instead, take it over: the desktop app lets go of it, and its conversation is kept. Back in the app, your next message there picks up from Vlens's replies."}
                  </div>
                </div>
                {handoff === "confirm" ? (
                  <span className="flex items-center gap-2 text-xs">
                    {elsewhere === "cli" ? "End the claude in that terminal?" : "Stop the desktop app's claude for this session?"}
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
                )}
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
            {slash && (
              <SlashPanel
                ui={slash}
                chat={chat}
                cwd={session?.cwd ?? newDraft?.cwd ?? null}
                model={currentModel}
                mode={mode}
                onModel={setModel}
                send={(t) => (replying ? setQueue((q) => [...q, { text: t, images: [] }]) : send(t, []))}
                onSettings={(card) => window.dispatchEvent(new CustomEvent("lens:open-settings", { detail: card }))}
                onTerminal={(cmd) => window.dispatchEvent(new CustomEvent("lens:terminal-claude", { detail: cmd }))}
                onClose={() => setSlash(null)}
              />
            )}
            <Composer
              placeholder={
                session
                  ? "Reply, or type / for commands"
                  : newDraft?.cwd
                    ? "What should Claude do in this folder?"
                    : "Pick a folder first"
              }
              disabled={!session && !newDraft?.cwd}
              running={replying}
              onSend={(text, images) => picked(text, images) || send(text, images)}
              onQueue={(text, images) => picked(text, images) || setQueue((q) => [...q, { text, images }])}
              onShiftTab={cycleMode}
              cwd={session?.cwd ?? newDraft?.cwd ?? null}
              onStop={() => {
                if (queue.length) setPaused(true); // like Esc in the terminal: don't fire the queued messages
                if (rootPending) chat.stop(rootPending.runId);
              }}
              footer={
                <div className="flex flex-wrap items-center gap-2">
                  {newDraft && !rootPending && <FolderChip value={newDraft.cwd} onChange={setDraftFolder} recent={recent} />}
                  {newDraft?.cwd && !rootPending && (
                    <WorktreeToggle
                      cwd={newDraft.cwd}
                      on={!!newDraft.worktree}
                      onChange={(on) => {
                        rememberWorktree(newDraft.cwd, on);
                        chat.setDraft({ cwd: newDraft.cwd, worktree: on });
                      }}
                    />
                  )}
                  {botMode !== undefined ? <BotMode mode={botMode} /> : elsewhere ? null : <span className="@2xl/chat:hidden"><ModePicker mode={mode} cliMode={chat.settings?.cliMode} onChange={setMode} /></span>}
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
      </>
      )}
    </main>
    </CwdContext.Provider>
  );
}

// A bot's mode, shown but not picked here: the bot's settings decide it.
function BotMode({ mode }: { mode: RootMode | "" }) {
  const cur = PERMISSION_MODES.find((m) => m.id === mode) ?? { label: "Same as my Claude Code", hint: "Your Claude Code's default mode and allow rules" };
  return (
    <span title={`${cur.hint}. This bot always runs in this mode; change it in the bot's settings.`} className="flex items-center gap-1 rounded-lg bg-sunken px-1.5 py-0.5 text-[0.7rem] text-muted">
      <ShieldCheck size={11} className="shrink-0" />
      {cur.label}
    </span>
  );
}

// "claude-opus-5-5" -> "Opus 5.5"
function prettyModel(m: string | null) {
  const x = m?.match(/(opus|sonnet|haiku|fable)-(\d+)(?:-(\d+))?/i);
  return x ? `${x[1][0].toUpperCase()}${x[1].slice(1)} ${x[2]}${x[3] ? `.${x[3]}` : ""}` : null;
}

// The permission mode for your next messages. Shift+Tab in the message box cycles it, like the terminal.
function ModePicker({ mode, cliMode, onChange, header }: { mode: RootMode; cliMode?: RootMode; onChange: (m: RootMode) => void; header?: boolean }) {
  const cur = PERMISSION_MODES.find((m) => m.id === mode)!;
  const Icon = mode === "plan" ? Eye : mode === "bypassPermissions" ? ShieldOff : mode === "auto" ? Sparkles : mode === "acceptEdits" ? Pencil : ShieldCheck;
  return (
    <label
      title={`${cur.hint}. Shift+Tab in the message box switches modes.`}
      className={`items-center gap-1 rounded-lg ${header ? "hidden border border-line px-2 py-1 text-xs @2xl/chat:flex" : "flex bg-sunken px-1.5 py-0.5 text-[0.7rem]"} ${mode === "bypassPermissions" ? "text-red-600" : mode === "default" ? "text-muted" : "text-accent"}`}
    >
      <Icon size={11} className="shrink-0" />
      <select value={mode} onChange={(e) => onChange(e.target.value as RootMode)} aria-label="Permission mode" className={`bg-transparent outline-none ${header ? "max-w-[7.5rem] @5xl:max-w-none" : ""}`}>
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
