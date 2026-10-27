"use client";

import { ChevronUp, SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ToolRun } from "@/hooks/useTreeChat";
import { toolSummary } from "./MessageBubble";

// Shows the real tool calls the sub-agent ran (Read, Grep, Bash, ...) like a terminal log.
export function TerminalConsole({ runs, running }: { runs: ToolRun[]; running: boolean }) {
  const [open, setOpen] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  // Pop open the first time the agent starts using tools.
  const seen = useRef(0);
  useEffect(() => {
    if (runs.length > 0 && seen.current === 0 && running) setOpen(true);
    seen.current = runs.length;
    end.current?.scrollIntoView({ block: "end" });
  }, [runs.length, running]);

  return (
    <div className="border-t border-line bg-term text-term-ink">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs text-term-ink/80 hover:text-term-ink"
      >
        <SquareTerminal size={14} />
        <span className="font-medium">Terminal</span>
        <span className="opacity-60">{runs.length} commands</span>
        {running && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
        <ChevronUp size={14} className={`ml-auto transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
      <div
        className={`overflow-y-auto font-mono text-[0.72rem] leading-relaxed transition-[max-height] duration-200 scroll-thin ${
          open ? "max-h-56" : "max-h-0"
        }`}
      >
        <div className="space-y-2 px-4 pb-3">
          {runs.length === 0 && <div className="opacity-50">No commands yet.</div>}
          {runs.map((r) => (
            <div key={r.id}>
              <div className="flex gap-2">
                <span className="text-emerald-400">$</span>
                <span className="text-amber-300">{r.name}</span>
                <span className="break-all opacity-90">{toolSummary(r.name, r.input)}</span>
              </div>
              {r.result ? (
                <pre
                  className={`mt-0.5 max-h-28 overflow-hidden whitespace-pre-wrap pl-4 opacity-60 ${r.result.isError ? "text-red-300" : ""}`}
                >
                  {r.result.text.split("\n").slice(0, 6).join("\n").slice(0, 600)}
                </pre>
              ) : (
                <div className="pl-4 opacity-50">running…</div>
              )}
            </div>
          ))}
          <div ref={end} />
        </div>
      </div>
    </div>
  );
}
