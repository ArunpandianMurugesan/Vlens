"use client";

import { BellRing, Bot, Brain, Check, ChevronRight, CircleSlash, CornerDownRight, ExternalLink, Loader2, Sparkles, Terminal, XCircle } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { LiveRun, ToolRun } from "@/hooks/useTreeChat";
import { useSnippetHighlights } from "@/lib/highlight";
import { splitPasted } from "@/lib/pasted";
import { unavailableCommand } from "@/lib/slash";
import type { Block, ChatMessage, SubThread } from "@/lib/types";
import { FILE_TOOLS, FileChip } from "./FileChip";
import { useCwd, useFiles } from "./FileContext";
import { Markdown } from "./Markdown";
import { PastedCard, PastedText } from "./PastedCard";
import { PlanRecord } from "./PlanCard";
import { QuestionRecord } from "./QuestionCard";

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
  const files = useFiles();
  const cwd = useCwd();
  const pending = !run.result;
  // Tools that read a file (Read, Glob…) get a small "open" button too.
  const filePath = (run.input as { file_path?: string } | null)?.file_path;
  return (
    <div className="rounded-lg border border-line bg-sunken/60 text-[0.8rem]">
      <div className="flex items-center">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-muted hover:text-ink"
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
      {filePath && files && (
        <button
          onClick={() => files.open(filePath, { cwd })}
          className="mr-1.5 shrink-0 rounded p-1 text-muted hover:bg-panel hover:text-accent"
          title={`Open ${filePath}`}
          aria-label={`Open ${filePath}`}
        >
          <ExternalLink size={12} />
        </button>
      )}
      </div>
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

// One tool call in a few words: "Read upsert.go", "Edited route.ts", "Ran npm test".
const base = (p: unknown) => (typeof p === "string" ? p.split("/").filter(Boolean).slice(-1)[0] ?? p : "");
function runLabel(r: ToolRun) {
  const i = (r.input ?? {}) as Record<string, unknown>;
  const cut = (t: string, n = 32) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
  switch (r.name) {
    case "Read":
      return `Read ${base(i.file_path)}`;
    case "Edit":
    case "MultiEdit":
      return `Edited ${base(i.file_path)}`;
    case "Write":
      return `Wrote ${base(i.file_path)}`;
    case "NotebookEdit":
      return `Edited ${base(i.notebook_path)}`;
    case "Bash":
      return `Ran ${cut(String(i.command ?? "").split("\n")[0])}`;
    case "Grep":
      return `Searched "${cut(String(i.pattern ?? ""), 24)}"`;
    case "Glob":
      return `Listed ${cut(String(i.pattern ?? ""), 24)}`;
    case "WebFetch":
      try {
        return `Fetched ${new URL(String(i.url)).host}`;
      } catch {
        return "Fetched a page";
      }
    case "WebSearch":
      return `Searched the web "${cut(String(i.query ?? ""), 24)}"`;
    case "Task":
    case "Agent":
      return `Agent: ${cut(String(i.description ?? "a task"))}`;
    case "TodoWrite":
      return "Updated the to-do list";
    default:
      return r.name.startsWith("mcp__") ? r.name.split("__").slice(-1)[0].replace(/_/g, " ") : r.name;
  }
}

// A run of tool calls as one line ("✓ Read a.ts · Read b.ts · Edited c.ts"),
// opened to see each one. A plan or a question Claude asked shows in full.
function ToolGroup({ runs }: { runs: ToolRun[] }) {
  const [open, setOpen] = useState(false);
  const special = runs.filter((r) => r.name === "ExitPlanMode" || r.name === "AskUserQuestion");
  const plain = runs.filter((r) => !special.includes(r));
  const pending = plain.some((r) => !r.result);
  const failed = plain.filter((r) => r.result?.isError).length;
  const stopped = plain.filter((r) => r.result?.stopped).length;
  const labels = plain.map(runLabel);
  const shown = labels.slice(0, 4).join(" · ");
  return (
    <div className="space-y-1.5" data-no-select>
      {plain.length > 0 && (
        <div>
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex max-w-full items-center gap-2 text-left text-[0.8rem] text-muted hover:text-ink">
            {pending ? (
              <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
            ) : failed ? (
              <XCircle size={13} className="shrink-0 text-red-500" />
            ) : stopped ? (
              <CircleSlash size={13} className="shrink-0" />
            ) : (
              <Check size={13} className="shrink-0" />
            )}
            <span className="min-w-0 truncate">
              {shown}
              {labels.length > 4 && ` · +${labels.length - 4} more`}
              {failed > 0 && <span className="text-red-500"> · {failed} failed</span>}
              {stopped > 0 && <span> · didn&apos;t finish</span>}
            </span>
            <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
          </button>
          {open && (
            <div className="mt-1.5 space-y-1.5">
              {plain.map((r) => (FILE_TOOLS.has(r.name) ? <FileChip key={r.id} run={r} /> : <ToolRow key={r.id} run={r} />))}
            </div>
          )}
        </div>
      )}
      {special.map((r) => (r.name === "ExitPlanMode" ? <PlanRecord key={r.id} input={r.input} result={r.result} /> : <QuestionRecord key={r.id} input={r.input} result={r.result} />))}
    </div>
  );
}

// Where a long conversation was squeezed into a summary to free up context.
function CompactDivider({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-1" data-no-select>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 text-xs text-muted hover:text-ink">
        <span className="h-px flex-1 bg-line" />
        <span className="flex items-center gap-1.5">
          Conversation compacted · summary
          <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        </span>
        <span className="h-px flex-1 bg-line" />
      </button>
      {open && (
        <div className="mt-2 rounded-xl border border-line bg-sunken px-4 py-3 text-muted">
          <Markdown text={text} />
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

// What you typed: pastes as cards you can open, and long text cut short with
// "Show more", so one big message doesn't fill the screen.
const LONG_LINES = 12;
const LONG_CHARS = 900;
function UserText({ text }: { text: string }) {
  const parts = useMemo(() => splitPasted(text), [text]);
  const [open, setOpen] = useState<number | null>(null);
  const pastes = parts.filter((p) => p.kind === "paste");
  return (
    <>
      {parts.map((p, i) => (p.kind === "text" ? <LongText key={i} text={p.text} /> : null))}
      {pastes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap justify-end gap-1.5 whitespace-normal">
          {parts.map((p, i) => (p.kind === "paste" ? <PastedCard key={i} text={p.text} open={open === i} onClick={() => setOpen((v) => (v === i ? null : i))} /> : null))}
        </div>
      )}
      {open !== null && parts[open] && (
        <div className="mt-1.5">
          <PastedText text={parts[open].text} />
        </div>
      )}
    </>
  );
}

function LongText({ text }: { text: string }) {
  const long = text.length > LONG_CHARS || text.split("\n").length > LONG_LINES;
  const [more, setMore] = useState(false);
  if (!long) return <span className="block">{text}</span>;
  return (
    <span className="block">
      <span className={`block ${more ? "" : "max-h-64 overflow-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"}`}>{text}</span>
      <button type="button" data-no-select onClick={() => setMore((m) => !m)} className="mt-1 text-xs font-medium text-muted hover:text-accent">
        {more ? "Show less" : "Show more"}
      </button>
    </span>
  );
}

// Turn the flat block list into renderable pieces, pairing each tool call with its result.
// A call with no result in a turn that's over never got one: Claude stopped
// (closed, killed, restarted) mid-call, so it shows as not finished, not running.
const STOPPED = { text: "Claude stopped before this finished, so it has no result.", isError: false, stopped: true };

function groupBlocks(blocks: Block[], stopped = false) {
  const results = new Map<string, NonNullable<ToolRun["result"]>>();
  for (const b of blocks) if (b.kind === "tool_result") results.set(b.toolUseId, { text: b.text, isError: b.isError });
  type Piece =
    | { type: "text"; text: string }
    | { type: "thinking"; text: string }
    | { type: "notice"; text: string }
    | { type: "tools"; runs: ToolRun[] };
  const out: Piece[] = [];
  for (const b of blocks) {
    if (b.kind === "text") out.push({ type: "text", text: b.text });
    else if (b.kind === "thinking") out.push({ type: "thinking", text: b.text });
    else if (b.kind === "notice") out.push({ type: "notice", text: b.text });
    else if (b.kind === "tool_use") {
      const run = { id: b.id, name: b.name, input: b.input, result: results.get(b.id) ?? (stopped ? STOPPED : undefined) };
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
  stopped?: boolean; // the turn is over: a tool call still waiting never finished
}

export function MessageBubble({
  message,
  ctx,
  childThreads = [],
  activeThreadIds,
  onOpenThread,
  streaming,
  compact,
  stopped,
}: Props) {
  const textRef = useRef<HTMLDivElement>(null);
  const pieces = useMemo(() => groupBlocks(message.blocks, stopped), [message.blocks, stopped]);
  const isUser = message.role === "user";

  useSnippetHighlights(
    textRef,
    childThreads.map((t) => ({ text: t.selectedContextText, active: !!activeThreadIds?.has(t.id) })),
    message.id + message.blocks.length,
  );

  const summary = message.blocks.find((b) => b.kind === "compact");
  if (summary) return <CompactDivider text={summary.text} />;

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          data-msg={message.id}
          data-ctx={ctx}
          className="max-w-[85%] whitespace-pre-wrap wrap-anywhere rounded-2xl rounded-br-md bg-user px-4 py-2.5 text-[0.95rem] leading-relaxed"
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
          {message.blocks.map((b, i) => (b.kind === "text" ? <UserText key={i} text={b.text} /> : null))}
        </div>
      </div>
    );
  }

  const Icon = message.role === "sub-agent" ? Sparkles : Bot;
  return (
    <div className="flex gap-3">
      {/* Claude's replies are plain text, like the design; a sub-agent's keep their mark. */}
      {!compact && message.role === "sub-agent" && (
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon size={15} />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-2.5">
        <div ref={textRef} data-msg={message.id} data-ctx={ctx} className="space-y-2.5">
          {pieces.map((p, i) =>
            p.type === "text" ? (
              ctx === "root" && unavailableCommand(p.text) ? (
                // Claude here has no screen for this command: run it in the session's terminal.
                <div key={i} className="space-y-1.5">
                  <Markdown text={p.text} />
                  <button
                    data-no-select
                    onClick={() => window.dispatchEvent(new CustomEvent("lens:terminal-claude", { detail: `/${unavailableCommand(p.text)}` }))}
                    className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent"
                  >
                    <Terminal size={12} /> Run /{unavailableCommand(p.text)} in this session&apos;s terminal
                  </button>
                </div>
              ) : (
                <Markdown key={i} text={p.text} className={streaming && i === pieces.length - 1 ? "caret" : ""} />
              )
            ) : p.type === "thinking" ? (
              <Thinking key={i} text={p.text} />
            ) : p.type === "notice" ? (
              <div key={i} className="flex items-center gap-1.5 text-xs text-muted" data-no-select>
                <BellRing size={12} className="shrink-0 text-accent" />
                <span className="min-w-0 truncate">{p.text}</span>
              </div>
            ) : (
              <ToolGroup key={i} runs={p.runs} />
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
