"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { ChatWindow } from "@/components/ChatWindow";
import { messageText } from "@/components/MessageBubble";
import { type Picked, SelectionPopover } from "@/components/SelectionPopover";
import { Sidebar } from "@/components/Sidebar";
import { ReviewView } from "@/components/ReviewView";
import { SettingsView } from "@/components/SettingsView";
import { SubAgentPanel } from "@/components/SubAgentPanel";
import { useReview } from "@/hooks/useReview";
import { useTreeChat } from "@/hooks/useTreeChat";

// How far each panel underneath peeks out to the left of the one on top.
const PEEK = 28;

export default function Home() {
  const chat = useTreeChat();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<"chat" | "settings" | "review">("chat");
  const [tab, setTab] = useState<"sessions" | "review">("sessions");
  const review = useReview();

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

  const n = chat.stack.length;

  return (
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
      {view === "settings" ? (
        <SettingsView chat={chat} onBack={() => setView(tab === "review" ? "review" : "chat")} />
      ) : view === "review" ? (
        <ReviewView
          review={review}
          home={review.board?.home ?? ""}
          onMenu={() => setSidebarOpen(true)}
          onStart={(prompt, mode, cwd) => {
            // A review becomes a normal Lens session: switch to it and send the first message.
            setTab("sessions");
            setView("chat");
            void chat.sendRoot(prompt, mode, undefined, [], cwd);
          }}
        />
      ) : (
        <ChatWindow chat={chat} onMenu={() => setSidebarOpen(true)} />
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
    </div>
  );
}
