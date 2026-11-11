"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { ChatWindow } from "@/components/ChatWindow";
import { messageText } from "@/components/MessageBubble";
import { type Picked, SelectionPopover } from "@/components/SelectionPopover";
import { Sidebar } from "@/components/Sidebar";
import { toggleSidebar } from "@/lib/sidebar";
import { ReviewView } from "@/components/ReviewView";
import { SettingsView } from "@/components/SettingsView";
import { SubAgentPanel } from "@/components/SubAgentPanel";
import { NewVersion } from "@/components/NewVersion";
import { UpdateBanner } from "@/components/UpdateBanner";
import { FilesProvider, useFiles } from "@/components/FileContext";
import { FileViewer } from "@/components/FileViewer";
import { runInTerminal, TerminalPanel } from "@/components/TerminalPanel";
import { HomeView } from "@/components/HomeView";
import { MarketplaceView } from "@/components/MarketplaceView";
import { HistoryView } from "@/components/HistoryView";
import { HarnessView } from "@/components/HarnessView";
import { SpaceRail } from "@/components/SpaceRail";
import { type Go, QuickSwitcher } from "@/components/QuickSwitcher";
import { useMenu } from "@/lib/menu";
import { Inspector, useInspector } from "@/components/Inspector";
import { LensSettingsContext } from "@/components/LensSettings";
import { useReview } from "@/hooks/useReview";
import { useTreeChat } from "@/hooks/useTreeChat";
import { GetStarted, needsSetup } from "@/components/GetStarted";
import type { SetupStatus } from "@/lib/types";

// How far each panel underneath peeks out to the left of the one on top.
const PEEK = 28;

export default function Home() {
  const chat = useTreeChat();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // ⌘B slides the sidebar away and back on a wide window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // The header's menu button: slides the sidebar over on a narrow window, brings it back on a wide one.
  const showSidebar = () => setSidebarOpen(true);
  const [view, setView] = useState<"chat" | "settings" | "review" | "marketplace" | "history" | "harness">("chat");
  const [tab, setTab] = useState<"sessions" | "review">("sessions");
  // Where Settings' back button goes: the space you came from.
  const [back, setBack] = useState<"chat" | "review" | "harness">("chat");
  const openShared = (page: "settings" | "marketplace") => {
    setView((v) => {
      if (v === "chat" || v === "review" || v === "harness") setBack(v);
      return page;
    });
  };
  // "/mcp" and "/hooks" open their Settings page.
  const [settingsCard, setSettingsCard] = useState<"mcp" | "hooks" | null>(null);
  useEffect(() => {
    const open = (e: Event) => {
      setSettingsCard((e as CustomEvent<"mcp" | "hooks">).detail);
      setView("settings");
    };
    window.addEventListener("lens:open-settings", open);
    return () => window.removeEventListener("lens:open-settings", open);
  }, []);
  // A bot's Skills card: get more from the Marketplace.
  useEffect(() => {
    const open = () => setView("marketplace");
    window.addEventListener("lens:open-marketplace", open);
    return () => window.removeEventListener("lens:open-marketplace", open);
  }, []);
  const review = useReview();
  // First launch, or Claude Code missing / signed out: show Get started over the app.
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: SetupStatus | null) => s && needsSetup(s) && setSetup(s))
      .catch(() => {});
  }, []);

  const onAsk = (p: Picked, prompt?: string) => {
    if (p.ctx === "live") return; // still streaming; wait for the final message
    const parentThreadId = p.ctx === "root" ? null : p.ctx;
    const pool = parentThreadId ? chat.threads[parentThreadId]?.messages : chat.session?.messages;
    const msg = pool?.find((m) => m.id === p.messageId);
    if (!msg) return;
    chat.spawnThread({
      parentThreadId,
      anchorMessageId: msg.id,
      selectedText: p.text,
      parentMessageText: messageText(msg),
      prompt,
    });
  };

  // Opening a session from elsewhere (a notification click) shows the chat.
  useEffect(() => {
    if (chat.activeId) setView((v) => (v === "review" || v === "harness" ? v : "chat"));
  }, [chat.activeId]);

  const n = chat.stack.length;
  // Where the ⌘K switcher can take you.
  const go = useMemo<Go>(
    () => ({
      session: (id) => {
        setTab("sessions");
        setView("chat");
        chat.selectSession(id);
      },
      pr: (url) => {
        setTab("review");
        setView("review");
        void review.select(url);
      },
      page: (p) => {
        if (p === "home") {
          setTab("sessions");
          setView("chat");
          chat.goHome();
        } else if (p === "review") {
          setTab("review");
          setView("review");
        } else setView(p);
      },
      newIn: (cwd) => {
        setTab("sessions");
        setView("chat");
        chat.newSession(cwd);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the chat and review hooks' functions are stable
    [chat.selectSession, chat.goHome, chat.newSession, review.select],
  );

  // The Mac menus (desktop/main.cjs).
  const [inspectorOn, setInspectorOn] = useInspector();
  const here = chat.session?.cwd ?? chat.draft?.cwd ?? "";
  useMenu({
    "new-session": () => go.newIn(here),
    "new-worktree": () => {
      go.newIn(here);
      if (here) chat.setDraft({ cwd: here, worktree: true });
    },
    "open-folder": () => go.newIn(""),
    archive: () => {
      const id = chat.activeId;
      if (id && window.confirm("Archive this session? You can open it again from Archived.")) void chat.archiveSession(id, true).then(() => chat.goHome());
    },
    "go-harness": () => setView("harness"),
    "go-sessions": () => {
      setTab("sessions");
      setView("chat");
    },
    "go-review": () => go.page("review"),
    "go-home": () => go.page("home"),
    "go-history": () => go.page("history"),
    "go-marketplace": () => go.page("marketplace"),
    settings: () => go.page("settings"),
    switcher: () => window.dispatchEvent(new Event("lens:switcher")),
    "next-waiting": () => {
      const waiting = chat.sessions.filter((x) => x.active?.waitingFor).sort((a, b) => a.active!.startedAt - b.active!.startedAt);
      if (!waiting.length) return;
      const i = waiting.findIndex((x) => x.id === chat.activeId);
      go.session(waiting[(i + 1) % waiting.length].id);
    },
    "open-session": (id) => id && go.session(id),
    "toggle-sidebar": () => toggleSidebar(),
    "toggle-inspector": () => setInspectorOn(!inspectorOn),
  });

  return (
    <LensSettingsContext.Provider value={chat.settings}>
      {setup && <GetStarted initial={setup} onDone={() => setSetup(null)} />}
      <QuickSwitcher chat={chat} review={review} go={go} />
      <FilesProvider>
      <div className="flex h-dvh overflow-hidden">
        <SpaceRail
          space={view === "settings" || view === "marketplace" ? null : view === "harness" ? "harness" : view === "review" ? "review" : "sessions"}
          badge={{ review: review.prs.filter((p) => p.lane === "needsYou").length }}
          page={view === "settings" || view === "marketplace" ? view : null}
          onSettings={() => openShared("settings")}
          onMarketplace={() => openShared("marketplace")}
          limits={chat.limits}
          refreshingLimits={chat.refreshingLimits}
          onRefreshLimits={chat.refreshLimits}
          onSpace={(s) => {
            if (s === "harness") return setView("harness");
            setTab(s);
            setView(s === "review" ? "review" : "chat");
          }}
        />
        {/* Pages with their own navigation (like the design) don't get the sessions list beside it. */}
        {view !== "harness" && view !== "settings" && view !== "marketplace" && view !== "history" && (
        <Sidebar
          sessions={chat.sessions}
          activeId={chat.activeId}
          onSelect={(id) => {
            setView("chat");
            chat.selectSession(id);
          }}
          onNew={() => {
            setView("chat");
            chat.newSession();
          }}
          onSettings={() => setView("settings")}
        onMarketplace={() => setView("marketplace")}
        marketplaceOpen={false}
        onHistory={() => setView("history")}
        historyOpen={false}
        onHome={() => {
          setTab("sessions");
          setView("chat");
          chat.goHome();
        }}
          settingsOpen={false}
          tab={tab}
          onTab={(t) => {
            setTab(t);
            setView(t === "review" ? "review" : "chat");
          }}
          review={review}
          onPickPr={(url) => {
            setView("review");
            void review.select(url);
          }}
          actions={chat}
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        )}
        {view === "harness" ? (
          <HarnessView />
        ) : view === "history" ? (
          <HistoryView
            chat={chat}
            onMenu={() => setView(back)}
            onOpen={(id) => {
              setTab("sessions");
              setView("chat");
              chat.selectSession(id);
            }}
          />
        ) : view === "marketplace" ? (
          <MarketplaceView chat={chat} onMenu={() => setView(back)} />
        ) : view === "settings" ? (
          <SettingsView
            key={settingsCard ?? "all"}
            chat={chat}
            initial={settingsCard}
            onBack={() => {
              setSettingsCard(null);
              setView(back);
            }}
          />
        ) : view === "review" ? (
          <ReviewView
            review={review}
            home={review.board?.home ?? ""}
            onMenu={showSidebar}
            chat={chat}
            // A PR's sessions open in its own tabs, right on the Review page.
            renderChat={() => <ChatWithFiles chat={chat} onMenu={showSidebar} />}
          />
        ) : !chat.activeId && !chat.draft ? (
          // Nothing open: the home dashboard (also what the app opens to).
          <HomeView
            chat={chat}
            onMenu={showSidebar}
            onNew={() => chat.newSession()}
            onReview={() => {
              setTab("review");
              setView("review");
            }}
          />
        ) : (
          <ChatWithFiles chat={chat} onMenu={showSidebar} />
        )}

        {/* Stacked sub-agent sheets. Deeper levels slide in on top; parents peek out on the left. */}
        <div className="pointer-events-none fixed inset-y-0 right-0 z-50 w-full sm:w-[min(560px,calc(100vw-2rem))]">
          <AnimatePresence>
            {chat.stack.map((id, i) => {
              const t = chat.threads[id];
              if (!t) return null;
              const behind = n - 1 - i;
              return (
                <motion.div
                  key={id}
                  initial={{ x: "100%", opacity: 0.6 }}
                  animate={{ x: -behind * PEEK, opacity: 1, scale: 1 - behind * 0.02 }}
                  exit={{ x: "100%", opacity: 0.6 }}
                  transition={{ type: "spring", stiffness: 380, damping: 38 }}
                  style={{ zIndex: i }}
                  className="pointer-events-auto absolute inset-0 origin-left overflow-hidden border-l border-line shadow-2xl sm:rounded-l-2xl"
                >
                  <SubAgentPanel thread={t} depth={i + 1} chat={chat} />
                  {behind > 0 && (
                    // Click a panel underneath to bring it back to the top.
                    <button
                      aria-label="Back to this level"
                      onClick={() => chat.closeFrom(chat.stack[i + 1])}
                      className="absolute inset-0 bg-black/10 transition hover:bg-black/5"
                    />
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        <SelectionPopover onAsk={onAsk} />
        <UpdateBanner />
        <NewVersion />
      </div>
      </FilesProvider>
    </LensSettingsContext.Provider>
  );
}

// The chat, with the file panel and/or the terminal beside it (files on top,
// terminal below when both are open). Maximized files fill the space. On a
// phone-width window the panel covers the chat.
function ChatWithFiles({ chat, onMenu }: { chat: ReturnType<typeof useTreeChat>; onMenu: () => void }) {
  const files = useFiles()!;
  const showFiles = files.tabs.length > 0;
  const open = showFiles || files.terminal;
  const [inspector] = useInspector();
  const cwd = chat.session?.cwd ?? chat.draft?.cwd ?? null;
  // A command only the CLI's own screen can run (/permissions, /rewind…): hand
  // the session to the real interactive `claude` in its terminal, with the
  // command typed in. Vlens's Claude steps aside first, so only one writes it.
  useEffect(() => {
    const run = async (e: Event) => {
      const id = chat.activeId;
      if (!id) return;
      const cmd = (e as CustomEvent<string>).detail;
      const r = await fetch(`/api/sessions/${id}/live`, { method: "POST" });
      if (!r.ok) return window.alert((await r.json().catch(() => null))?.error ?? "Couldn't hand the session to the terminal.");
      files.setTerminal(true);
      runInTerminal(id, cwd, `claude --resume ${id} ${shellQuote(cmd)}`);
    };
    window.addEventListener("lens:terminal-claude", run);
    return () => window.removeEventListener("lens:terminal-claude", run);
  }, [chat.activeId, cwd, files]);
  useMenu({ "toggle-terminal": () => files.setTerminal((t) => !t) });
  // Ctrl+` shows or hides the terminal, like VS Code.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "`") {
        e.preventDefault();
        files.setTerminal((t) => !t);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [files]);
  return (
    <div className="flex min-w-0 flex-1">
      <div className={`min-w-0 flex-1 ${showFiles && files.maximized ? "hidden" : "flex"}`}>
        <ChatWindow chat={chat} onMenu={onMenu} />
      </div>
      {/* Its inspector, when nothing else is open beside the chat. */}
      {!open && inspector && chat.session && <Inspector chat={chat} />}
      {open && (
        <div
          className={`fixed inset-0 z-40 flex flex-col border-l border-line md:static md:z-auto ${
            showFiles && files.maximized ? "md:flex-1" : "md:w-[46%] md:min-w-[380px] md:max-w-[900px] md:shrink-0"
          }`}
        >
          {showFiles && (
            <div className={`min-h-0 ${files.terminal ? "h-[55%] border-b border-line" : "flex-1"}`}>
              <FileViewer />
            </div>
          )}
          {files.terminal && (
            <div className="min-h-0 flex-1">
              {/* Wait for the session to load, so its shell starts in the session's folder. */}
              {!chat.activeId || chat.session?.id === chat.activeId ? (
                <TerminalPanel owner={chat.activeId ?? `folder:${cwd ?? "~"}`} cwd={cwd} />
              ) : (
                <div className="h-full bg-term" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
