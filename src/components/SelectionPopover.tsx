"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowUp, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

export interface Picked {
  ctx: string; // "root" or sub-thread id
  messageId: string;
  text: string;
}

// Watches text selection anywhere on the page. When it sits inside a single
// message of the main chat, shows a box next to it: type a comment or question
// and Enter sends it to a sub-agent, or the button opens one with nothing asked yet.
// Sub-agents go one level deep: text in a sub-agent's reply doesn't spawn another.
export function SelectionPopover({ onAsk }: { onAsk: (p: Picked, prompt?: string) => void }) {
  const [state, setState] = useState<(Picked & { x: number; y: number }) | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    const check = () => {
      // Typing in the box moves focus off the selection; keep the box (and what it picked).
      if (document.activeElement?.closest("[data-ask-btn]")) return;
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.isCollapsed || text.length < 2) return setState(null);
      const range = sel.getRangeAt(0);
      const host = (n: Node | null) =>
        (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-msg]") ?? null;
      const a = host(range.startContainer);
      const b = host(range.endContainer);
      if (!a || a !== b || a.dataset.ctx !== "root") return setState(null);
      const rect = range.getBoundingClientRect();
      setState({
        ctx: a.dataset.ctx!,
        messageId: a.dataset.msg!,
        text,
        x: Math.min(Math.max(rect.left + rect.width / 2, 170), window.innerWidth - 170),
        y: Math.max(rect.top - 8, 48),
      });
    };
    const onUp = () => setTimeout(check, 0);
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-ask-btn]")) {
        setState(null);
        setQ("");
      }
    };
    document.addEventListener("mouseup", onUp);
    document.addEventListener("keyup", onUp);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("keyup", onUp);
      document.removeEventListener("mousedown", onDown);
    };
  }, []);

  const ask = (prompt?: string) => {
    if (!state) return;
    onAsk(state, prompt?.trim() || undefined);
    window.getSelection()?.removeAllRanges();
    setState(null);
    setQ("");
  };

  return (
    <AnimatePresence>
      {state && (
        <motion.div
          data-ask-btn
          initial={{ opacity: 0, y: 4, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.96 }}
          transition={{ duration: 0.12 }}
          style={{ left: state.x, top: state.y }}
          className="fixed z-[100] flex w-80 max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-full items-center gap-1 rounded-full bg-ink p-1 text-xs text-bg shadow-lg"
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(q);
              } else if (e.key === "Escape") {
                setState(null);
                setQ("");
              }
            }}
            placeholder="Comment or ask about this…"
            aria-label="Comment or ask a sub-agent about the selected text"
            className="min-w-0 flex-1 bg-transparent px-2.5 py-1 text-bg outline-none placeholder:text-bg/55"
          />
          {q.trim() ? (
            <button onClick={() => ask(q)} className="rounded-full bg-accent p-1.5 text-white" aria-label="Ask the sub-agent">
              <ArrowUp size={13} />
            </button>
          ) : (
            <button
              onClick={() => ask()}
              className="flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-medium hover:bg-bg/10"
              title="Open a sub-agent panel without asking yet"
            >
              <Sparkles size={13} />
              Sub-Agent
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
