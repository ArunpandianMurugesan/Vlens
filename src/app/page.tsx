"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
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
import { TerminalPanel } from "@/components/TerminalPanel";
import { HomeView } from "@/components/HomeView";
import { MarketplaceView } from "@/components/MarketplaceView";
import { HistoryView } from "@/components/HistoryView";
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
  const [view, setView] = useState<"chat" | "settings" | "review" | "marketplace" | "history">("chat");
  const [tab, setTab] = useState<"sessions" | "review">("sessions");
  const review = useReview();
  // First launch, or Claude Code missing / signed out: show Get started over the app.
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  useEffect(() => {
    fetch("/api/setup")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: SetupStatus | null) => s && needsSetup(s) && setSetup(s))
      .catch(() => {});
  }, []);

  const onAsk = (p: Picked) => {
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
    });
  };

  // Opening a session from elsewhere (a notification click) shows the chat.
  useEffect(() => {
    if (chat.activeId) setView((v) => (v === "review" ? v : "chat"));
  }, [chat.activeId]);

  const n = chat.stack.length;

  return (
    <LensSettingsContext.Provider value={chat.settings}>
      {setup && <GetStarted initial={setup} onDone={() => setSetup(null)} />}
      <FilesProvider>
      <div className="flex h-dvh overflow-hidden">
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
        marketplaceOpen={view === "marketplace"}
        onHistory={() => setView("history")}
        historyOpen={view === "history"}
        onHome={() => {
          setTab("sessions");
          setView("chat");
          chat.goHome();
        }}
          settingsOpen={view === "settings"}
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
        {view === "history" ? (
          <HistoryView
            chat={chat}
            onMenu={showSidebar}
            onOpen={(id) => {
              setTab("sessions");
              setView("chat");
              chat.selectSession(id);
            }}
          />
        ) : view === "marketplace" ? (
          <MarketplaceView chat={chat} onMenu={showSidebar} />
        ) : view === "settings" ? (
          <SettingsView chat={chat} onBack={() => setView(tab === "review" ? "review" : "chat")} />
        ) : view === "review" ? (
          <ReviewView
            review={review}
            home={review.board?.home ?? ""}
            onMenu={showSidebar}
            onStart={(prompt, mode, cwd) => {
              // A review becomes a normal Vlens session: switch to it and send the first message.
              setTab("sessions");
              setView("chat");
              void chat.sendRoot(prompt, mode, undefined, [], cwd);
            }}
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
  const cwd = chat.session?.cwd ?? chat.draft?.cwd ?? null;
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
              <TerminalPanel cwd={cwd} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
