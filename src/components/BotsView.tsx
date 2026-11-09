"use client";

import { ArrowLeft, ArrowUp, Bot as BotIcon, Check, ChevronDown, FileText, GitFork, Loader2, MessageSquare, Plus, RefreshCw, SlidersHorizontal, Trash2, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { TreeChat } from "@/hooks/useTreeChat";
import type { Bot, BotConcept } from "@/lib/types";
import { BotSettings } from "./BotSettings";
import { IssueCards, type IssueCardData, useIssues } from "./IssueCards";
import { Markdown } from "./Markdown";
import { ContextBadge } from "./Usage";

// The Bots space, three screens:
//   Home       your bots as cards: what each is doing, what waits on you
//   Workspace  one bot: its main chat (which keeps the issue cards) and, on the
//              left, its forked sessions, one per card, each its own full chat
//   Settings   its configuration (BotSettings.tsx)
// A bot is a folder Claude Code understands (lib/bots.ts); its chats run on the
// Agent SDK (lib/botAgent.ts), and its cards work in the background (lib/botThreads.ts).

type Stats = { cards: number; running: number; waiting: number; ready: number; triggersOn: number; every: number | null; lastCheck: string | null; lastCard: string | null };
type BotRow = Bot & { stats?: Stats };
type View = { kind: "home" } | { kind: "bot"; id: string; fork: string | null } | { kind: "settings"; id: string } | { kind: "notes"; id: string };
const VIEW = "lens.botView";

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error ?? r.statusText);
  return d as T;
}

const btn = "inline-flex items-center gap-1 rounded-lg border border-line bg-bg px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";
const primary = "inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50";
const Hint = ({ children }: { children: ReactNode }) => <p className="text-xs text-muted">{children}</p>;
const short = (n: string) => n.replace(/^claude\.ai /, "");
const ago = (iso: string | null | undefined) => {
  if (!iso) return "";
  const t = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? Date.parse(`${iso}T12:00:00`) : Date.parse(iso);
  const m = Math.round((Date.now() - t) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

function Avatar({ b, size = 28 }: { b: Bot; size?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {b.avatar || b.name[0]}
    </span>
  );
}

const ruleCount = (b: Bot) => (b.rules ? b.rules.allowed.length + b.rules.lookAt.length + b.rules.dontLookAt.length : 0);
const isNew = (b: Bot) => !b.about && !ruleCount(b) && !b.notes;

function readView(): View {
  try {
    // A bell notification asks for a bot (and maybe a card).
    const asked = JSON.parse(sessionStorage.getItem("lens.botScreen") ?? "null")?.id;
    sessionStorage.removeItem("lens.botScreen");
    if (asked) return { kind: "bot", id: asked, fork: null };
    const v = JSON.parse(localStorage.getItem(VIEW) ?? "null");
    if (v?.kind === "bot" || v?.kind === "settings") return v.kind === "bot" ? { kind: "bot", id: v.id, fork: null } : v;
  } catch {}
  return { kind: "home" };
}

export function BotsView({ chat, renderChat }: { chat: TreeChat; renderChat: (bot: Bot) => ReactNode }) {
  const [bots, setBots] = useState<BotRow[] | null>(null);
  const [view, setView] = useState<View>(readView);
  const [err, setErr] = useState<string | null>(null);
  // An issue card the bell points at.
  const [focus, setFocus] = useState<string | null>(() => {
    try {
      const t = JSON.parse(sessionStorage.getItem("lens.botFocus") ?? "null");
      sessionStorage.removeItem("lens.botFocus");
      return t?.kind === "issue" ? String(t.key) : null;
    } catch {
      return null;
    }
  });

  const load = useCallback(async () => {
    const d = await api<{ bots: BotRow[] }>("/api/bots");
    setBots(d.bots);
  }, []);
  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
    // Its setup changes from the chat (a rule, a note), and its cards work on their own.
    const t = setInterval(() => void load().catch(() => {}), 5_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW, JSON.stringify(view));
    } catch {}
  }, [view]);
  // The bell, while this space is open.
  useEffect(() => {
    const open = (e: Event) => {
      const d = (e as CustomEvent<{ bot: string; target: { kind: string; key: string } | null }>).detail;
      setView({ kind: "bot", id: d.bot, fork: null });
      if (d.target?.kind === "issue") setFocus(d.target.key);
    };
    window.addEventListener("lens:open-bot", open);
    return () => window.removeEventListener("lens:open-bot", open);
  }, []);

  const bot = view.kind === "home" ? null : (bots?.find((b) => b.id === view.id) ?? null);
  // A bot that's gone (deleted elsewhere): back home.
  useEffect(() => {
    if (bots && view.kind !== "home" && !bot) setView({ kind: "home" });
  }, [bots, view, bot]);

  const save = async (patch: Partial<Bot>) => {
    if (!bot) return;
    setErr(null);
    try {
      const next = await api<Bot>(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      setBots((all) => all?.map((b) => (b.id === next.id ? { ...b, ...next } : b)) ?? null);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const create = async (name: string) => {
    const b = await api<Bot>("/api/bots", { method: "POST", body: JSON.stringify({ name }) });
    await load();
    chat.newSession(); // its greeting: it sets itself up from the chat
    setView({ kind: "bot", id: b.id, fork: null });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {err && (
        <p className="flex items-center gap-2 border-b border-line bg-red-500/10 px-4 py-1.5 text-xs text-red-600">
          {err}
          <button onClick={() => setErr(null)} className="ml-auto" aria-label="Dismiss">
            <X size={12} />
          </button>
        </p>
      )}
      {!bots ? (
        <Loader2 size={16} className="m-6 animate-spin text-muted" />
      ) : view.kind === "home" || !bot ? (
        <Home
          bots={bots}
          onOpen={(id) => {
            chat.newSession();
            setView({ kind: "bot", id, fork: null });
          }}
          onCreate={create}
        />
      ) : view.kind === "settings" ? (
        <BotSettings key={bot.id} bot={bot} save={save} onBack={() => setView({ kind: "bot", id: bot.id, fork: null })} onNotes={() => setView({ kind: "notes", id: bot.id })} onDeleted={() => void load().then(() => setView({ kind: "home" }))} />
      ) : view.kind === "notes" ? (
        <Notes key={bot.id} bot={bot} onBack={() => setView({ kind: "settings", id: bot.id })} />
      ) : (
        <Workspace
          key={bot.id}
          bot={bot}
          chat={chat}
          renderChat={renderChat}
          focus={focus}
          fork={view.fork}
          setFork={(fork) => setView({ kind: "bot", id: bot.id, fork })}
          onHome={() => setView({ kind: "home" })}
          onSettings={() => setView({ kind: "settings", id: bot.id })}
        />
      )}
    </div>
  );
}

// ── Home: your bots as cards ─────────────────────────────────────────────────

function state(b: BotRow): { label: string; dot: string } {
  const s = b.stats;
  if (s?.running) return { label: "Working", dot: "bg-green-500" };
  if (s?.triggersOn) return { label: "Idle, watching", dot: "border-[1.5px] border-green-500" };
  if (isNew(b)) return { label: "New: set it up in its chat", dot: "bg-line" };
  return { label: "Idle, works when you message it", dot: "bg-line" };
}

function Home({ bots, onOpen, onCreate }: { bots: BotRow[]; onOpen: (id: string) => void; onCreate: (name: string) => Promise<void> }) {
  const [naming, setNaming] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const create = async (name: string) => {
    setNaming(false);
    setCreating(name);
    await onCreate(name).finally(() => setCreating(null));
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
      <div className="mx-auto max-w-6xl space-y-5 px-8 py-8 pr-16 md:pr-8">
        <div>
          <h1 className="text-2xl font-semibold">Your bots</h1>
          <p className="text-sm text-muted">Each bot has its own chat, memory and approvals.</p>
        </div>
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
          {bots.map((b) => {
            const s = b.stats;
            const st = state(b);
            const need = s?.waiting ?? 0;
            return (
              <div key={b.id} className={`flex flex-col gap-3.5 rounded-2xl border bg-panel p-4 shadow-sm ${need ? "border-amber-500/40" : "border-line"}`}>
                <div className="flex items-center gap-3">
                  <Avatar b={b} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{b.name}</div>
                    <div className="flex items-center gap-1.5 text-xs text-muted">
                      <span className={`h-[7px] w-[7px] shrink-0 rounded-full ${st.dot}`} aria-hidden />
                      {st.label}
                    </div>
                  </div>
                  {need > 0 && <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[0.7rem] font-semibold text-amber-700 dark:text-amber-400">{need} need you</span>}
                </div>
                <p className="line-clamp-2 min-h-[2.5rem] text-sm leading-relaxed">{b.about || <span className="text-muted">No description yet</span>}</p>
                <div className="grid grid-cols-3 gap-2 rounded-xl bg-sunken/60 p-2.5">
                  <Stat n={s?.cards ?? 0} label="Cards" />
                  <Stat n={s?.ready ? s.ready : (s?.running ?? 0)} label={s?.ready ? "Ready for you" : "Working"} />
                  <Stat n={s?.every ? `${s.every}m` : "Off"} label={s?.every ? "Checks every" : "Triggers"} />
                </div>
                <div className="flex min-h-[1.4rem] flex-wrap gap-1.5">
                  {b.mcp.slice(0, 4).map((m) => (
                    <span key={m} className="rounded-md bg-sunken px-2 py-0.5 text-[0.7rem]">
                      {short(m)}
                    </span>
                  ))}
                  {b.mcp.length > 4 && <span className="text-[0.7rem] text-muted">+{b.mcp.length - 4}</span>}
                </div>
                <div className="mt-auto flex items-center gap-2">
                  <button onClick={() => onOpen(b.id)} className={need ? primary : btn}>
                    Open
                  </button>
                  <span className="flex-1" />
                  <span className="text-[0.7rem] text-muted">{ago(s?.lastCheck ?? s?.lastCard)}</span>
                </div>
              </div>
            );
          })}
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-2 rounded-2xl border-[1.5px] border-dashed border-line p-4 text-center">
            {creating ? (
              <span className="flex items-center gap-2 text-sm text-muted">
                <Loader2 size={14} className="animate-spin" /> Creating {creating}…
              </span>
            ) : naming ? (
              <div className="w-full max-w-xs space-y-1.5">
                <NameField placeholder="Name it, e.g. Release helper" onDone={(n) => (n ? void create(n) : setNaming(false))} />
                <Hint>Then tell it in its chat what it&apos;s for. It sets itself up, and you approve each change.</Hint>
              </div>
            ) : (
              <button onClick={() => setNaming(true)} className="flex flex-col items-center gap-1.5 text-muted hover:text-accent">
                <Plus size={22} />
                <span className="font-semibold">New bot</span>
                <span className="text-xs">Name it, e.g. Release helper</span>
              </button>
            )}
          </div>
        </div>
        {!bots.length && (
          <div className="flex items-center gap-3 rounded-xl bg-accent-soft/40 px-4 py-3 text-sm">
            <BotIcon size={18} className="text-accent" />A bot is a helper you chat with. It can watch things on a schedule or your Claude sessions, work each issue in its own session, and asks before anything that needs your OK.
          </div>
        )}
      </div>
    </div>
  );
}

const Stat = ({ n, label }: { n: number | string; label: string }) => (
  <div className="min-w-0">
    <div className="text-base font-semibold">{n}</div>
    <div className="truncate text-[0.7rem] text-muted">{label}</div>
  </div>
);

// ── Workspace: main chat + forked sessions ──────────────────────────────────

const STARTERS = ["What can you help me with?", "What do you know about?", "What are your rules?"];
const NEW_STARTERS = ["Help me set you up", "Interview me about what you're for"];

function dot(c: IssueCardData) {
  if (c.live.asks.length) return "bg-amber-500";
  if (c.live.running) return "bg-accent animate-pulse";
  if (c.live.error) return "bg-red-500";
  if (/done|merged|closed|posted/i.test(c.status)) return "bg-green-500";
  if (/ready|draft/i.test(c.status)) return "bg-blue-500";
  return "bg-line";
}
function cardStatus(c: IssueCardData) {
  if (c.live.asks.length) return `${c.live.running ? "Working · " : ""}${c.live.asks.length} question${c.live.asks.length === 1 ? "" : "s"}`;
  if (c.live.running) return "Working…";
  if (c.live.error) return "Stopped with an error";
  return `${c.status}${c.updated ? ` · ${ago(c.updated)}` : ""}`;
}

function Workspace(p: { bot: BotRow; chat: TreeChat; renderChat: (bot: Bot) => ReactNode; focus: string | null; fork: string | null; setFork: (key: string | null) => void; onHome: () => void; onSettings: () => void }) {
  const { bot, chat, renderChat, fork, setFork } = p;
  const { cards, reload } = useIssues(bot.id);
  const threads = useMemo(() => new Set((cards ?? []).map((c) => c.thread).filter(Boolean) as string[]), [cards]);
  const forked = fork ? (cards ?? []).find((c) => c.key === fork) : null;
  // Main chats with this bot (its cards' threads are forks, listed on the left).
  const mains = chat.sessions.filter((s) => s.botId === bot.id && !threads.has(s.id));
  const [mainId, setMainId] = useState<string | null>(null);
  const [past, setPast] = useState(false);
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);

  // Remember which main chat you were in, to come back to from a fork.
  useEffect(() => {
    if (!fork && chat.activeId && !threads.has(chat.activeId) && mains.some((s) => s.id === chat.activeId)) setMainId(chat.activeId);
  }, [fork, chat.activeId, threads, mains]);
  // A fork: its thread is the open chat.
  useEffect(() => {
    if (forked?.thread && chat.activeId !== forked.thread) chat.selectSession(forked.thread);
  }, [forked?.thread]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFork = (key: string) => setFork(key);
  const backToMain = () => {
    setFork(null);
    if (mainId) chat.selectSession(mainId);
    else chat.newSession();
  };
  const inMain = !fork;
  const open = inMain ? (chat.session?.cwd === bot.dir && !threads.has(chat.session.id)) || chat.draft?.cwd === bot.dir : chat.activeId === forked?.thread;
  const start = (t: string) => {
    if (!t.trim()) return;
    setText("");
    void chat.sendRoot(t.trim(), (bot.mode || "default") as never, bot.model, [], bot.dir);
  };
  const checkNow = async () => {
    setChecking(true);
    for (const t of (bot.triggers ?? []).filter((x) => x.on)) await api(`/api/bots/${bot.id}/watch`, { method: "POST", body: JSON.stringify({ trigger: t.id }) }).catch(() => {});
    await reload();
    setChecking(false);
  };
  const hasTriggers = (bot.triggers ?? []).some((t) => t.on);
  const sub = inMain ? `Main chat${bot.stats?.every ? ` · checks every ${bot.stats.every} min` : ""}` : forked ? `Forked session · ${cardStatus(forked)}` : "Forked session";

  return (
    <div className="flex min-h-0 flex-1">
      <aside aria-label="Threads" className="flex w-64 shrink-0 flex-col gap-1 border-r border-line bg-sunken/40 px-2.5 py-3.5">
        <div className="flex items-center gap-2 px-2 pb-2">
          <Avatar b={bot} size={26} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{bot.name}</div>
            <div className="text-[0.7rem] text-muted">Threads</div>
          </div>
        </div>
        <button onClick={backToMain} aria-current={inMain} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left ${inMain ? "bg-accent-soft" : "hover:bg-panel/70"}`}>
          <MessageSquare size={15} className="shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Main chat</span>
            <span className="block text-[0.7rem] text-muted">All issue cards</span>
          </span>
        </button>
        <div className="flex items-center gap-1.5 px-2 pb-1 pt-3.5 text-[0.7rem] font-semibold text-muted">
          <GitFork size={12} /> Forked sessions
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto scroll-thin">
          {cards === null && <Loader2 size={13} className="m-2 animate-spin text-muted" />}
          {cards?.map((c) => (
            <button
              key={c.key}
              onClick={() => c.thread && openFork(c.key)}
              disabled={!c.thread}
              aria-current={fork === c.key}
              title={c.thread ? `${c.key} · ${c.title}` : "Not started yet"}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left disabled:opacity-50 ${fork === c.key ? "bg-accent-soft" : "hover:bg-panel/70"}`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot(c)}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{c.title || c.key}</span>
                <span className="block truncate text-[0.7rem] text-muted">
                  {c.key} · {cardStatus(c)}
                </span>
              </span>
            </button>
          ))}
          {cards?.length === 0 && <p className="px-2.5 py-1 text-[0.7rem] text-muted">None yet. Ask about an issue or PR in the main chat, or add a trigger, and each one gets a card here.</p>}
        </div>
        <p className="px-2 pt-2 text-[0.7rem] leading-relaxed text-muted">Each card is worked on in its own session. Open it here to chat with it full size; the main chat keeps the overview.</p>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="@container flex h-[52px] shrink-0 items-center gap-2.5 border-b border-line px-4 pr-14 md:pr-4">
          <button onClick={p.onHome} className="inline-flex items-center gap-1 rounded-lg bg-sunken px-2 py-1 text-xs hover:text-accent">
            <ArrowLeft size={13} /> All bots
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{inMain ? bot.name : forked ? `${forked.key} · ${forked.title}` : fork}</div>
            <div className="truncate text-[0.7rem] text-muted">{sub}</div>
          </div>
          {open && chat.session && <ContextBadge ctx={chat.session.context} />}
          {inMain ? (
            <>
              {hasTriggers && (
                <button onClick={() => void checkNow()} disabled={checking} className={btn}>
                  {checking ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} Check now
                </button>
              )}
              <button onClick={() => chat.newSession()} className={btn}>
                <Plus size={11} /> New chat
              </button>
              {mains.length > 0 && (
                <div className="relative">
                  <button onClick={() => setPast((v) => !v)} className={btn}>
                    Past chats <ChevronDown size={11} />
                  </button>
                  {past && (
                    <div className="absolute right-0 top-8 z-30 max-h-80 w-72 overflow-y-auto rounded-xl border border-line bg-panel py-1 shadow-xl scroll-thin">
                      {mains.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => {
                            setPast(false);
                            chat.selectSession(s.id);
                          }}
                          className={`block w-full truncate px-3 py-1.5 text-left text-sm hover:bg-sunken ${chat.activeId === s.id ? "text-accent" : ""}`}
                        >
                          {s.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <button onClick={backToMain} className={btn}>
              Back to main chat
            </button>
          )}
          <button onClick={p.onSettings} className={btn}>
            <SlidersHorizontal size={12} /> Configure
          </button>
        </header>

        {inMain ? (
          <>
            {cards && <IssueCards bot={bot} cards={cards} reload={reload} focus={p.focus} onFork={openFork} />}
            <div className="flex min-h-0 flex-1">
              {open ? (
                <div className="flex min-h-0 min-w-0 flex-1">{renderChat(bot)}</div>
              ) : (
                <Greeting bot={bot} text={text} setText={setText} start={start} />
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-line bg-sunken/50 px-4 py-1.5 text-xs text-muted">
              <GitFork size={12} />
              <span className="flex-1">Forked from {bot.name}&apos;s main chat. Its card there stays in sync: same session, memory and approvals.</span>
            </div>
            <div className="flex min-h-0 flex-1">{open ? <div className="flex min-h-0 min-w-0 flex-1">{renderChat(bot)}</div> : <Loader2 size={16} className="m-6 animate-spin text-muted" />}</div>
          </>
        )}
      </main>
    </div>
  );
}

function Greeting({ bot, text, setText, start }: { bot: Bot; text: string; setText: (t: string) => void; start: (t: string) => void }) {
  const fresh = isNew(bot);
  return (
    <div className="flex flex-1 flex-col justify-end gap-4 overflow-y-auto p-6 scroll-thin">
      <div className="mx-auto w-full max-w-2xl space-y-3">
        <div className="flex gap-3">
          <Avatar b={bot} />
          <div className="rounded-2xl rounded-tl-md border border-line px-4 py-2.5 text-sm leading-relaxed">
            {fresh ? (
              <>Hi, I&apos;m {bot.name}, and I&apos;m new. Tell me what I&apos;m for, what I may do, where to look and what&apos;s off limits, and I&apos;ll set myself up. You approve each change right here.</>
            ) : (
              <>
                Hi, I&apos;m {bot.name}.{bot.about ? ` ${bot.about.replace(/\.?$/, ".")}` : ""} Ask me about an issue or PR and I&apos;ll open a card for it, or ask me to change my setup.
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 pl-10">
          {(fresh ? NEW_STARTERS : STARTERS).map((s) => (
            <button key={s} onClick={() => start(s)} className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-accent hover:text-accent">
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-2xl items-end gap-2 rounded-2xl border border-line bg-bg px-3 py-2 focus-within:border-accent">
        <textarea
          autoFocus
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              start(text);
            }
          }}
          placeholder="Ask the bot, or change its rules"
          className="field-sizing-content max-h-40 w-full resize-none bg-transparent py-1 text-sm outline-none"
        />
        <button onClick={() => start(text)} disabled={!text.trim()} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-white disabled:opacity-40" aria-label="Send">
          <ArrowUp size={15} />
        </button>
      </div>
    </div>
  );
}

// A text field you edit, then save (so each keystroke isn't a commit).
function Editable({ value, onSave, rows = 6, placeholder, mono }: { value: string; onSave: (v: string) => Promise<void>; rows?: number; placeholder?: string; mono?: boolean }) {
  const [v, setV] = useState(value);
  const [saved, setSaved] = useState(false);
  useEffect(() => setV(value), [value]);
  const dirty = v !== value;
  return (
    <div className="space-y-1.5">
      <textarea
        value={v}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => {
          setV(e.target.value);
          setSaved(false);
        }}
        className={`w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm outline-none focus:border-accent ${mono ? "font-mono text-xs" : ""}`}
      />
      {(dirty || saved) && (
        <div className="flex items-center gap-2">
          {dirty && (
            <button onClick={() => void onSave(v).then(() => setSaved(true))} className={btn}>
              Save
            </button>
          )}
          {saved && !dirty && (
            <span className="flex items-center gap-1 text-xs text-muted">
              <Check size={12} /> Saved. Used from the next message on.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Notes (its OKF bundle, full view) ────────────────────────────────────────

function Notes({ bot, onBack }: { bot: Bot; onBack: () => void }) {
  const [list, setList] = useState<BotConcept[] | null>(null);
  const [sel, setSel] = useState<{ path: string; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const base = `/api/bots/${bot.id}/knowledge`;
  const load = useCallback(() => api<{ concepts: BotConcept[] }>(base).then((d) => setList(d.concepts)), [base]);
  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, [load]);
  const open = async (path: string) => setSel(await api<{ path: string; text: string }>(`${base}?path=${encodeURIComponent(path)}`));
  const add = async (input: string) => {
    setAdding(false);
    const path = /\.md$/.test(input) ? input : `${input}.md`;
    const type = path.includes("/") ? path.split("/")[0].replace(/s$/, "") : "topic";
    try {
      const r = await api<{ text: string }>(base, { method: "PUT", body: JSON.stringify({ path, type }) });
      await load();
      setSel({ path, text: r.text });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const groups = useMemo(() => {
    const m = new Map<string, BotConcept[]>();
    for (const c of list ?? []) {
      const g = c.path.includes("/") ? c.path.split("/")[0] : "";
      m.set(g, [...(m.get(g) ?? []), c]);
    }
    return [...m.entries()];
  }, [list]);
  // Rules are edited in setup, which keeps these notes and its instructions in step.
  const isRule = (path: string) => path.startsWith("rules/");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2.5 border-b border-line py-2 pl-3 pr-14 md:pr-3">
        <button onClick={onBack} className="rounded-md p-1 text-muted hover:bg-panel hover:text-ink" aria-label="Back to settings">
          <ArrowLeft size={16} />
        </button>
        <Avatar b={bot} />
        <span className="text-sm font-medium">{bot.name}&apos;s notes</span>
        <span className="text-xs text-muted">{list ? `${list.length} · OKF` : ""}</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 overflow-y-auto border-r border-line p-2 scroll-thin">
          <div className="px-1 pb-2">
            {adding ? (
              <NameField placeholder="folder/name, e.g. processes/release" onDone={(v) => (v ? void add(v) : setAdding(false))} />
            ) : (
              <button onClick={() => setAdding(true)} className={`${btn} flex w-full items-center justify-center gap-1`}>
                <Plus size={11} /> New note
              </button>
            )}
          </div>
          {groups.map(([g, items]) => (
            <div key={g} className="mb-2">
              {g && <div className="px-2 pb-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-muted">{g}</div>}
              {items.map((c) => (
                <button key={c.path} onClick={() => void open(c.path)} className={`flex w-full items-start gap-1.5 rounded-lg px-2 py-1 text-left ${sel?.path === c.path ? "bg-panel text-ink shadow-sm" : "text-muted hover:bg-panel/60 hover:text-ink"}`}>
                  <FileText size={12} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{c.title}</span>
                    <span className="block text-[0.65rem] text-muted">updated {c.updated}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
          {err && <p className="px-2 text-xs text-red-600">{err}</p>}
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto p-4 scroll-thin">
          {!sel ? (
            <div className="mx-auto max-w-md space-y-2 pt-10 text-center text-sm text-muted">
              <p>Each note is one Markdown file about one thing, with a little YAML at the top. The path is its name.</p>
              <p>Pick one to read or edit it. Every change is saved in the bot&apos;s git history.</p>
            </div>
          ) : isRule(sel.path) ? (
            <div className="space-y-2">
              <span className="font-mono text-xs text-muted">knowledge/{sel.path}</span>
              <div className="rounded-xl border border-line p-4 text-sm">
                <Markdown text={sel.text.replace(/^---[\s\S]*?---\n/, "")} />
              </div>
              <Hint>To change its rules, ask the bot in the chat.</Hint>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted">knowledge/{sel.path}</span>
                <button
                  onClick={() => {
                    if (!window.confirm(`Delete knowledge/${sel.path}?`)) return;
                    void api(`${base}?path=${encodeURIComponent(sel.path)}`, { method: "DELETE" }).then(() => {
                      setSel(null);
                      return load();
                    });
                  }}
                  className="ml-auto rounded p-1 text-muted hover:text-red-600"
                  aria-label="Delete this note"
                >
                  <Trash2 size={13} />
                </button>
              </div>
              <Editable
                key={sel.path}
                value={sel.text}
                rows={24}
                mono
                onSave={async (text) => {
                  await api(base, { method: "PUT", body: JSON.stringify({ path: sel.path, text }) });
                  setSel({ ...sel, text });
                  await load();
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// A one-line field that takes a name: Enter to use it, Esc (or leaving it empty) to cancel.
function NameField({ placeholder, onDone }: { placeholder: string; onDone: (value: string | null) => void }) {
  const [v, setV] = useState("");
  return (
    <input
      autoFocus
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.nativeEvent.isComposing) onDone(v.trim() || null);
        if (e.key === "Escape") onDone(null);
      }}
      onBlur={() => !v.trim() && onDone(null)}
      className="w-full rounded-lg border border-accent bg-bg px-2 py-1.5 text-sm outline-none"
    />
  );
}
