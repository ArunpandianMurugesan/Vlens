"use client";

import { Bot, Brain, ChevronRight, CornerDownRight, Sparkles, Terminal, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { LiveRun, ToolRun } from "@/hooks/useTreeChat";
import { useSnippetHighlights } from "@/lib/highlight";
import type { Block, ChatMessage, SubThread } from "@/lib/types";
import { Markdown } from "./Markdown";

export function messageText(m: ChatMessage) {
  return m.blocks
    .filter((b): b is Extract<Block, { kind: "text" }> => b.kind === "text")
    .map((b) => b.text)
    .join("\n\n");
}

// The in-progress reply, shaped like a message so it renders the same way.
export function liveMessage(run: LiveRun, parentId: string, role: ChatMessage["role"] = "sub-agent"): ChatMessage {
  const blocks: Block[] = [];
  if (run.text) blocks.push({ kind: "text", text: run.text });
  for (const t of run.tools) {
    blocks.push({ kind: "tool_use", id: t.id, name: t.name, input: t.input });
    if (t.result) blocks.push({ kind: "tool_result", toolUseId: t.id, ...t.result });
  }
  return { id: "live", parentId, role, blocks, timestamp: new Date().toISOString() };
}

// One-line preview of a tool call, like the CLI shows it.
export function toolSummary(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = i.command ?? i.file_path ?? i.pattern ?? i.path ?? i.url ?? i.query ?? i.description ?? i.prompt;
  if (typeof pick === "string") return pick.replace(/\s+/g, " ");
  const s = JSON.stringify(input);
  return s === "{}" ? "" : s;
}

function ToolRow({ run }: { run: ToolRun }) {
  const [open, setOpen] = useState(false);
  const pending = !run.result;
  return (
    <div className="rounded-lg border border-line bg-sunken/60 text-[0.8rem]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-muted hover:text-ink"
      >
        <ChevronRight size={13} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        {run.result?.isError ? (
          <XCircle size={13} className="shrink-0 text-red-500" />
        ) : (
          <Terminal size={13} className={`shrink-0 ${pending ? "animate-pulse text-accent" : ""}`} />
        )}
        <span className="font-medium text-ink">{run.name}</span>
        <span className="truncate font-mono text-[0.75rem]">{toolSummary(run.name, run.input)}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2">
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[0.72rem] text-muted scroll-thin">
            {JSON.stringify(run.input, null, 2)}
          </pre>
          {run.result && (
            <pre
              className={`max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-term p-2 font-mono text-[0.72rem] scroll-thin ${
                run.result.isError ? "text-red-300" : "text-term-ink"
              }`}
            >
              {run.result.text.slice(0, 8000) || "(no output)"}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-[0.8rem]">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-muted hover:text-ink">
        <Brain size={13} />
        <span>Thinking</span>
        <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-1.5 border-l-2 border-line pl-3 text-muted">
          <Markdown text={text} />
        </div>
      )}
    </div>
  );
}

// Turn the flat block list into renderable pieces, pairing each tool call with its result.
function groupBlocks(blocks: Block[]) {
  const results = new Map<string, { text: string; isError: boolean }>();
  for (const b of blocks) if (b.kind === "tool_result") results.set(b.toolUseId, { text: b.text, isError: b.isError });
  type Piece = { type: "text"; text: string } | { type: "thinking"; text: string } | { type: "tools"; runs: ToolRun[] };
  const out: Piece[] = [];
  for (const b of blocks) {
    if (b.kind === "text") out.push({ type: "text", text: b.text });
    else if (b.kind === "thinking") out.push({ type: "thinking", text: b.text });
    else if (b.kind === "tool_use") {
      const run = { id: b.id, name: b.name, input: b.input, result: results.get(b.id) };
      const last = out[out.length - 1];
      if (last?.type === "tools") last.runs.push(run);
      else out.push({ type: "tools", runs: [run] });
    }
  }
  return out;
}

interface Props {
  message: ChatMessage;
  ctx: string; // "root" or the id of the sub-thread this message lives in
  childThreads?: SubThread[];
  activeThreadIds?: Set<string>;
  onOpenThread?: (id: string) => void;
  streaming?: boolean;
  compact?: boolean;
}

export function MessageBubble({
  message,
  ctx,
  childThreads = [],
  activeThreadIds,
  onOpenThread,
  streaming,
  compact,
}: Props) {
  const textRef = useRef<HTMLDivElement>(null);
  const pieces = useMemo(() => groupBlocks(message.blocks), [message.blocks]);
  const isUser = message.role === "user";

  useSnippetHighlights(
    textRef,
    childThreads.map((t) => ({ text: t.selectedContextText, active: !!activeThreadIds?.has(t.id) })),
    message.id + message.blocks.length,
  );

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          data-msg={message.id}
          data-ctx={ctx}
          className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-user px-4 py-2.5 text-[0.95rem] leading-relaxed"
        >
          {message.blocks.some((b) => b.kind === "image") && (
            <div className="mb-1.5 flex flex-wrap justify-end gap-1.5" data-no-select>
              {message.blocks.map((b, i) =>
                b.kind !== "image" ? null : b.src ? (
                  <a key={i} href={b.src} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- served from the session file */}
                    <img src={b.src} alt="Attached image" className="max-h-40 max-w-56 rounded-lg object-cover" loading="lazy" />
                  </a>
                ) : (
                  <em key={i} className="text-muted">[image]</em>
                ),
              )}
            </div>
          )}
          {message.blocks.map((b, i) => (b.kind === "text" ? <span key={i}>{b.text}</span> : null))}
        </div>
      </div>
    );
  }

  const Icon = message.role === "sub-agent" ? Sparkles : Bot;
  return (
    <div className="flex gap-3">
      {!compact && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon size={15} />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-2.5">
        <div ref={textRef} data-msg={message.id} data-ctx={ctx} className="space-y-2.5">
          {pieces.map((p, i) =>
            p.type === "text" ? (
              <Markdown key={i} text={p.text} className={streaming && i === pieces.length - 1 ? "caret" : ""} />
            ) : p.type === "thinking" ? (
              <Thinking key={i} text={p.text} />
            ) : (
              <div key={i} className="space-y-1.5" data-no-select>
                {p.runs.map((r) => (
                  <ToolRow key={r.id} run={r} />
                ))}
              </div>
            ),
          )}
          {streaming && pieces.at(-1)?.type !== "text" && <span className="caret text-sm text-muted" />}
        </div>

        {childThreads.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {childThreads.map((t) => {
              const active = activeThreadIds?.has(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => onOpenThread?.(t.id)}
                  className={`flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition ${
                    active
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line text-muted hover:border-accent hover:text-accent"
                  }`}
                >
                  <CornerDownRight size={12} className="shrink-0" />
                  <span className="truncate">“{t.selectedContextText.slice(0, 48)}”</span>
                  <span className="shrink-0 opacity-70">· {t.messages.filter((m) => m.role === "user").length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
