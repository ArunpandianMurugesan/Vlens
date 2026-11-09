"use client";

import { ArrowUp, ChevronDown, ChevronRight, FileText, Loader2, Split, Square, Ticket } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Bot } from "@/lib/types";
import { Markdown } from "./Markdown";
import { PermissionCard } from "./PermissionCard";

// A bot's issue cards, in its main chat. Each card is one Jira issue or PR,
// worked on in its own thread in the background (lib/botThreads.ts), with its
// memory in an OKF note (lib/botIssues.ts). Collapsed: where it stands and how
// many questions wait on you. Expanded: its recent messages, its questions, a
// reply box. Fork opens the whole thread as a full chat.

interface Live {
  running: boolean;
  prompt: string | null;
  text: string;
  status: { kind: string; tool?: string } | null;
  tools: { id: string; name: string }[];
  asks: Parameters<typeof PermissionCard>[0]["ask"][];
  error: string | null;
}
interface Card {
  key: string;
  title: string;
  status: string;
  thread: string | null;
  sources: string[];
  updated: string;
  live: Live;
}
interface Detail {
  issue: Card & { file: string; body: string };
  messages: { id: string; role: string; text: string; tools: string[] }[];
  live: Live;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? r.statusText);
  return d as T;
}

const btn = "flex items-center gap-1 rounded-lg border border-line px-2 py-0.5 text-xs hover:border-accent hover:text-accent disabled:opacity-50";

// A bot's cards, kept current (often while one works or waits on you).
export function useIssues(botId: string) {
  const [cards, setCards] = useState<Card[] | null>(null);
  const base = `/api/bots/${botId}/issues`;
  const load = useCallback(
    () =>
      api<{ issues: Card[] }>(base)
        .then((d) => setCards(d.issues))
        .catch(() => {}),
    [base],
  );
  const busy = !!cards?.some((c) => c.live.running || c.live.asks.length);
  useEffect(() => {
    void load();
    const t = setInterval(load, busy ? 2_500 : 10_000);
    return () => clearInterval(t);
  }, [load, busy]);
  return { cards, reload: load };
}

const SHOWN = "lens.botCardsShown";

export function IssueCards({ bot, cards, reload, focus, onFork }: { bot: Bot; cards: Card[]; reload: () => Promise<void>; focus: string | null; onFork: (key: string) => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  // The cards are listed on the left too, so here they're folded unless you open them
  // (remembered), a card has a question for you, or the bell points at one.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    try {
      setShown(localStorage.getItem(SHOWN) === "open");
    } catch {}
  }, []);
  const toggleShown = () =>
    setShown((v) => {
      try {
        localStorage.setItem(SHOWN, v ? "closed" : "open");
      } catch {}
      return !v;
    });
  const base = `/api/bots/${bot.id}/issues`;
  // The bell points at a card: open it.
  useEffect(() => {
    if (focus) setOpen((o) => new Set(o).add(focus));
  }, [focus]);

  if (!cards.length) return null;
  const waiting = cards.reduce((n, c) => n + c.live.asks.length, 0);
  const visible = shown || waiting > 0 || !!focus;
  return (
    <div className={`shrink-0 space-y-2 border-b border-line px-4 scroll-thin ${visible ? "max-h-[55%] overflow-y-auto py-3" : "py-2"}`}>
      <button onClick={toggleShown} aria-expanded={visible} className="flex items-center gap-2 text-[0.7rem] font-semibold text-muted hover:text-ink">
        <ChevronRight size={12} className={`transition-transform ${visible ? "rotate-90" : ""}`} />
        Issue cards · {cards.length}
        {waiting > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-700 dark:text-amber-400">{waiting} need you</span>}
      </button>
      {visible && cards.map((c) => (
        <IssueCard
          key={c.key}
          card={c}
          base={base}
          open={open.has(c.key)}
          onToggle={() =>
            setOpen((o) => {
              const n = new Set(o);
              if (n.has(c.key)) n.delete(c.key);
              else n.add(c.key);
              return n;
            })
          }
          onChange={reload}
          onFork={() => onFork(c.key)}
        />
      ))}
    </div>
  );
}

export type IssueCardData = Card;

function statusLine(c: Card) {
  if (c.live.asks.length) return "Waiting for you";
  if (c.live.running) {
    const s = c.live.status;
    return s?.kind === "tool" ? `Working · ${s.tool?.replace(/^mcp__[^_]+(?:_[^_]+)*__/, "")}` : "Working…";
  }
  if (c.live.error) return "Stopped with an error";
  return c.status;
}

function IssueCard({ card, base, open, onToggle, onChange, onFork }: { card: Card; base: string; open: boolean; onToggle: () => void; onChange: () => Promise<void>; onFork: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [text, setText] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const url = `${base}/${encodeURIComponent(card.key)}`;
  const live = detail?.live ?? card.live;
  const load = useCallback(
    () =>
      api<Detail>(url)
        .then(setDetail)
        .catch((e) => setErr((e as Error).message)),
    [url],
  );
  // While it's open: keep it current (often while it works).
  useEffect(() => {
    if (!open) return;
    void load();
    const t = setInterval(load, live.running ? 1_500 : 8_000);
    return () => clearInterval(t);
  }, [open, load, live.running]);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setErr(null);
    try {
      await api(url, { method: "POST", body: JSON.stringify({ prompt: t }) });
      setText("");
      await Promise.all([load(), onChange()]);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const asks = live.asks;

  return (
    <div className="rounded-xl border border-line bg-bg">
      <div className="flex items-center gap-2 pr-3">
        <button onClick={onToggle} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 text-left">
          <Ticket size={15} className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {card.key} · {card.title}
            </span>
            <span className="flex items-center gap-1 text-[0.7rem] text-muted">
              {live.running && !asks.length && <Loader2 size={10} className="animate-spin" />}
              {statusLine({ ...card, live })}
            </span>
          </span>
          {asks.length > 0 && <span className="shrink-0 rounded-lg bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">{asks.length === 1 ? "1 question" : `${asks.length} questions`}</span>}
          <ChevronDown size={14} className={`shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {card.thread && (
          <button onClick={onFork} title="Work on it in its own session, full size" className={btn}>
            <Split size={11} /> Open fork
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2 border-t border-line px-3 py-2.5">
          <button onClick={() => setShowNote((v) => !v)} className="flex items-center gap-1 text-[0.7rem] text-muted hover:text-accent">
            <FileText size={11} /> Context · {card.sources.length} source
            {card.sources.length === 1 ? "" : "s"} · updated {card.updated || "never"}
          </button>
          {showNote && detail && (
            <div className="max-h-56 overflow-y-auto rounded-lg bg-sunken/60 px-3 py-2 text-xs scroll-thin">
              <div className="mb-1 font-mono text-[0.65rem] text-muted">knowledge/{detail.issue.file}</div>
              <Markdown text={detail.issue.body} />
            </div>
          )}
          {!detail && <Loader2 size={13} className="animate-spin text-muted" />}
          {detail?.messages.slice(-6).map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-user px-3 py-1.5 text-sm">
                {m.text}
              </div>
            ) : (
              <div key={m.id} className="space-y-1">
                {m.tools.length > 0 && <div className="text-[0.65rem] text-muted">used {[...new Set(m.tools.map((t) => t.replace(/^mcp__.*__/, "")))].join(", ")}</div>}
                {m.text && (
                  <div className="w-fit max-w-[95%] rounded-2xl rounded-tl-md border border-line px-3 py-1.5 text-sm">
                    <Markdown text={m.text} />
                  </div>
                )}
              </div>
            ),
          )}
          {live.running && live.prompt && !detail?.messages.some((m) => m.role === "user" && m.text === live.prompt) && (
            <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-user px-3 py-1.5 text-sm">{live.prompt}</div>
          )}
          {live.running && live.text && (
            <div className="w-fit max-w-[95%] rounded-2xl rounded-tl-md border border-line px-3 py-1.5 text-sm">
              <Markdown text={live.text} />
            </div>
          )}
          {asks.map((a) => (
            <PermissionCard key={a.id} ask={a} />
          ))}
          {live.error && !live.running && <p className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-600">{live.error}</p>}
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex items-end gap-2">
            <div className="flex flex-1 items-end gap-2 rounded-xl border border-line px-2.5 py-1 focus-within:border-accent">
              <textarea
                rows={1}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={live.running ? `${card.key} is working…` : `Reply about ${card.key}…`}
                className="field-sizing-content max-h-32 w-full resize-none bg-transparent py-1 text-sm outline-none"
              />
              <button
                onClick={() => void send()}
                disabled={!text.trim() || live.running}
                className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40"
                aria-label={`Send to ${card.key}`}
              >
                <ArrowUp size={13} />
              </button>
            </div>
            {live.running && (
              <button onClick={() => void api(url, { method: "DELETE" }).then(load)} className={btn}>
                <Square size={10} /> Stop
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
