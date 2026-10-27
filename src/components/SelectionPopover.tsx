"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

export interface Picked {
  ctx: string; // "root" or sub-thread id
  messageId: string;
  text: string;
}

// Watches text selection anywhere on the page. When it sits inside a single
// message, shows an "Ask Sub-Agent" button next to it.
export function SelectionPopover({ onAsk }: { onAsk: (p: Picked) => void }) {
  const [state, setState] = useState<(Picked & { x: number; y: number }) | null>(null);

  useEffect(() => {
    const check = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.isCollapsed || text.length < 2) return setState(null);
      const range = sel.getRangeAt(0);
      const host = (n: Node | null) =>
        (n instanceof Element ? n : n?.parentElement)?.closest<HTMLElement>("[data-msg]") ?? null;
      const a = host(range.startContainer);
      const b = host(range.endContainer);
      if (!a || a !== b) return setState(null);
      const rect = range.getBoundingClientRect();
      setState({
        ctx: a.dataset.ctx!,
        messageId: a.dataset.msg!,
        text,
        x: Math.min(Math.max(rect.left + rect.width / 2, 80), window.innerWidth - 80),
        y: Math.max(rect.top - 8, 48),
      });
    };
    const onUp = () => setTimeout(check, 0);
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest("[data-ask-btn]")) setState(null);
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

  return (
    <AnimatePresence>
      {state && (
        <motion.button
          data-ask-btn
          initial={{ opacity: 0, y: 4, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.96 }}
          transition={{ duration: 0.12 }}
          style={{ left: state.x, top: state.y }}
          className="fixed z-[100] flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-medium text-bg shadow-lg"
          onClick={() => {
            onAsk(state);
            window.getSelection()?.removeAllRanges();
            setState(null);
          }}
        >
          <Sparkles size={13} />
          Ask Sub-Agent
        </motion.button>
      )}
    </AnimatePresence>
  );
}
