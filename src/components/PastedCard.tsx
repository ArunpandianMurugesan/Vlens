"use client";

import { FileText, X } from "lucide-react";
import { lineCount } from "@/lib/pasted";

// A paste shown as a small card: its first lines and how long it is.
export function PastedCard({ text, open, onClick, onRemove }: { text: string; open?: boolean; onClick: () => void; onRemove?: () => void }) {
  const lines = lineCount(text);
  const preview = text.trim().split("\n").slice(0, 2).join("\n");
  return (
    <div className="group relative" data-no-select>
      <button
        type="button"
        onClick={onClick}
        title={open ? "Hide the pasted text" : "Show the pasted text"}
        className={`flex h-[4.25rem] w-44 flex-col justify-between rounded-lg border bg-sunken/60 px-2.5 py-1.5 text-left transition hover:border-accent ${
          open ? "border-accent" : "border-line"
        }`}
      >
        <span className="line-clamp-2 whitespace-pre-wrap break-all font-mono text-[0.68rem] leading-snug text-muted">{preview}</span>
        <span className="flex items-center gap-1 text-[0.65rem] font-medium uppercase tracking-wide text-muted">
          <FileText size={10} /> Pasted · {lines} {lines === 1 ? "line" : "lines"}
        </span>
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove pasted text"
          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink text-bg opacity-0 shadow group-hover:opacity-100 focus:opacity-100"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}

// The full paste, scrollable, under its card.
export function PastedText({ text }: { text: string }) {
  return (
    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-line bg-sunken/60 p-2.5 text-left font-mono text-xs leading-relaxed scroll-thin">
      {text}
    </pre>
  );
}
