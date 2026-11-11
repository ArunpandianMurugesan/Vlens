"use client";

import { GitFork, GitPullRequest, History, Home, MessageSquare, Plus, Search, Settings, SquareTerminal, Store } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { Review } from "@/hooks/useReview";
import type { TreeChat } from "@/hooks/useTreeChat";
import type { SessionSummary } from "@/lib/types";
import { groupOf } from "./ReviewSidebar";

// ⌘K from anywhere: find a session, a PR, a bot or an app action and go there.
//   ↩ open · ⌘↩ new session in that folder · ⌥↩ open the session in Terminal

export interface Go {
  session: (id: string) => void;
  pr: (url: string) => void;
  page: (p: "home" | "history" | "settings" | "marketplace" | "review") => void;
  newIn: (cwd: string) => void;
}

interface Item {
  id: string;
  group: "Sessions" | "Review" | "Bots" | "Actions";
  title: string;
  meta: string;
  icon: ReactNode;
  cwd?: string | null; // its folder, for ⌘↩
  session?: string; // for ⌥↩
  run: () => void;
  rank: number; // lower first, before matching
}

const home = (p: string) => p.replace(/^\/Users\/[^/]+/, "~");
const ago = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};

function sessionMeta(s: SessionSummary) {
  const where = s.active ? (s.active.entrypoint === "desktop" ? "desktop app" : s.active.byLens ? "Vlens" : "Terminal") : null;
  const state = s.active?.waitingFor ? "needs you" : s.active?.status === "busy" ? "working" : s.archivedAt ? "archived" : ago(s.updatedAt);
  return [s.projectName, where, state].filter(Boolean).join(" · ");
}
const dot = (s: SessionSummary) => (
  <span className={`h-2 w-2 rounded-full ${s.active?.waitingFor ? "bg-amber-500" : s.active?.status === "busy" ? "bg-emerald-500" : s.active ? "border-[1.5px] border-emerald-500" : "bg-line"}`} aria-hidden />
);

// Bold the first place the search shows up.
function Hit({ text, q }: { text: string; q: string }) {
  const w = q.trim().split(/\s+/)[0]?.toLowerCase();
  const i = w ? text.toLowerCase().indexOf(w) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <strong className="font-semibold">{text.slice(i, i + w.length)}</strong>
      {text.slice(i + w.length)}
    </>
  );
}

export function QuickSwitcher({ chat, review, go }: { chat: TreeChat; review: Review; go: Go }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const show = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("lens:switcher", show);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("lens:switcher", show);
    };
  }, []);
  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
  }, [open]);

  const here = chat.session?.cwd ?? chat.draft?.cwd ?? null;
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const sessions = chat.sessions;
    for (const s of sessions)
      out.push({
        id: `s:${s.id}`,
        group: "Sessions",
        title: s.title,
        meta: sessionMeta(s),
        icon: dot(s),
        cwd: s.cwd,
        session: s.id,
        run: () => go.session(s.id),
        rank: (s.active?.waitingFor ? 0 : s.active ? 1 : 2) + (s.archivedAt ? 5 : 0),
      });
    for (const p of review.prs) {
      const g = groupOf(p);
      out.push({
        id: `p:${p.url}`,
        group: "Review",
        title: `PR: ${p.title}`,
        meta: `${p.repo.split("/")[1]} #${p.number} · ${g === "yours" ? "your move" : g === "ready" ? "ready to merge" : g === "waiting" ? "waiting on others" : p.why}`,
        icon: <GitPullRequest size={14} className="text-muted" />,
        cwd: review.cloneFor(p),
        run: () => go.pr(p.url),
        rank: g === "yours" ? 0 : g === "ready" ? 1 : 2,
      });
    }
    const page = (id: Parameters<Go["page"]>[0], title: string, icon: ReactNode, meta = ""): Item => ({ id: `a:${id}`, group: "Actions", title, meta, icon, run: () => go.page(id), rank: 1 });
    const cur = chat.session;
    if (cur && cur.messages.length)
      out.push(
        { id: "a:fork", group: "Actions", title: "Fork this session", meta: `"${cur.title.slice(0, 30)} ↳" · ⇧⌘F`, icon: <GitFork size={14} className="text-muted" />, run: () => window.dispatchEvent(new CustomEvent("lens:menu", { detail: "fork" })), rank: 0 },
        { id: "a:fork-t", group: "Actions", title: "Fork this session in Terminal", meta: "claude --resume … --fork-session", icon: <SquareTerminal size={14} className="text-muted" />, run: () => window.dispatchEvent(new CustomEvent("lens:menu", { detail: "fork-terminal" })), rank: 1 },
      );
    out.push(
      { id: "a:new", group: "Actions", title: "New session", meta: here ? `in ${home(here)}` : "", icon: <Plus size={14} className="text-muted" />, cwd: here, run: () => go.newIn(here ?? ""), rank: 0 },
      page("home", "Home", <Home size={14} className="text-muted" />),
      page("review", "Vlens Review", <GitPullRequest size={14} className="text-muted" />),
      page("history", "History", <History size={14} className="text-muted" />),
      page("marketplace", "Marketplace", <Store size={14} className="text-muted" />),
      page("settings", "Settings", <Settings size={14} className="text-muted" />, "⌘,"),
    );
    return out;
  }, [chat.sessions, chat.session, review, go, here]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const hits = items.filter((i) => words.every((w) => `${i.title} ${i.meta}`.toLowerCase().includes(w)));
    const order: Item["group"][] = ["Sessions", "Review", "Bots", "Actions"];
    // With nothing typed: what needs you and what's recent, a few of each.
    const cap = q ? { Sessions: 8, Review: 5, Bots: 5, Actions: 8 } : { Sessions: 6, Review: 3, Bots: 4, Actions: 3 };
    const starts = (i: Item) => (words[0] && i.title.toLowerCase().startsWith(words[0]) ? 0 : 1);
    return order.flatMap((g) =>
      hits
        .filter((i) => i.group === g)
        .sort((a, b) => starts(a) - starts(b) || a.rank - b.rank)
        .slice(0, cap[g]),
    );
  }, [items, q]);
  // A "new session" choice at the end of any search, like the design's.
  const withNew = useMemo<Item[]>(
    () =>
      q.trim() && !shown.some((i) => i.id === "a:new")
        ? [...shown, { id: "a:new-q", group: "Actions", title: `New session about "${q.trim()}"`, meta: here ? `in ${home(here)}` : "", icon: <Plus size={14} className="text-muted" />, cwd: here, run: () => go.newIn(here ?? ""), rank: 9 }]
        : shown,
    [shown, q, here, go],
  );
  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;
  const close = () => setOpen(false);
  const pick = (i: Item | undefined, how: "open" | "new" | "terminal" = "open") => {
    if (!i) return;
    close();
    if (how === "new") go.newIn(i.cwd ?? here ?? "");
    else if (how === "terminal" && i.session) void fetch(`/api/sessions/${i.session}/terminal`, { method: "POST" });
    else i.run();
  };

  let last: string | null = null;
  return (
    <div className="fixed inset-0 z-[60] flex justify-center bg-black/30 pt-[12vh]" onMouseDown={close}>
      <div role="dialog" aria-label="Quick switcher" className="flex h-fit max-h-[70vh] w-[620px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <label className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
          <Search size={18} className="text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") close();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setSel((s) => Math.min(s + 1, withNew.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSel((s) => Math.max(s - 1, 0));
              } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                pick(withNew[sel], e.metaKey || e.ctrlKey ? "new" : e.altKey ? "terminal" : "open");
              }
            }}
            placeholder="Search sessions, PRs and actions"
            aria-label="Search sessions, PRs and actions"
            className="flex-1 bg-transparent text-lg outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-line px-1.5 text-[0.7rem] text-muted">esc</kbd>
        </label>
        <div ref={list} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2 scroll-thin">
          {!withNew.length && <p className="px-3 py-6 text-center text-sm text-muted">Nothing matches.</p>}
          {withNew.map((i, n) => {
            const head = i.group !== last ? i.group : null;
            last = i.group;
            const on = n === sel;
            return (
              <div key={i.id}>
                {head && <div className="px-2.5 pb-1 pt-2.5 text-[0.7rem] font-semibold text-muted first:pt-1">{head}</div>}
                <button
                  data-i={n}
                  role="option"
                  aria-selected={on}
                  onMouseMove={() => setSel(n)}
                  onClick={(e) => pick(i, e.metaKey || e.ctrlKey ? "new" : e.altKey ? "terminal" : "open")}
                  className={`flex h-10 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm ${on ? "bg-accent text-white" : ""}`}
                >
                  <span className={`flex w-4 shrink-0 justify-center ${on ? "[&_*]:!text-white" : ""}`}>{i.icon}</span>
                  <span className="min-w-0 flex-1 truncate">
                    <Hit text={i.title} q={q} />
                  </span>
                  <span className={`max-w-[45%] shrink-0 truncate text-[0.7rem] ${on ? "text-white/85" : "text-muted"}`}>{i.meta}</span>
                  {on && <span className="shrink-0 text-[0.7rem]">↩</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex h-9 shrink-0 items-center gap-4 border-t border-line px-4 text-[0.7rem] text-muted">
          <span>↑↓ move</span>
          <span>↩ open</span>
          <span>⌘↩ new session there</span>
          <span className="flex items-center gap-1">
            <SquareTerminal size={11} />
            ⌥↩ open in Terminal
          </span>
          <span className="ml-auto flex items-center gap-1">
            <MessageSquare size={11} /> ⌘K
          </span>
        </div>
      </div>
    </div>
  );
}
