"use client";

import { Bell } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BotNotification } from "@/lib/types";

// The bell at the top right: what your bots want you to know (not Mac
// notifications; those are for Claude sessions). Clicking one opens that bot
// on the thing it's about.

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

export function BotBell({ rail }: { rail?: boolean } = {}) {
  const [list, setList] = useState<BotNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const load = useCallback(
    () =>
      fetch("/api/bot-notifications")
        .then((r) => r.json())
        .then((d: { notifications: BotNotification[]; unread: number }) => {
          setList(d.notifications);
          setUnread(d.unread);
        })
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    void load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    void load();
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open, load]);

  const read = (body: object) =>
    fetch("/api/bot-notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(load);
  const go = (n: BotNotification) => {
    setOpen(false);
    if (!n.read) void read({ ids: [n.id] });
    window.dispatchEvent(new CustomEvent("lens:open-bot", { detail: { bot: n.bot, target: n.target ?? null } }));
  };

  return (
    // In the rail (wide windows), or floating top right where the rail is hidden.
    <div ref={box} className={rail ? "relative" : "fixed right-3 top-2.5 z-40 md:hidden"}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="What your bots want you to know"
        aria-label={`Bot notifications${unread ? `, ${unread} new` : ""}`}
        className={`relative flex items-center justify-center transition hover:text-ink ${rail ? `h-9 w-9 rounded-xl ${open ? "bg-accent-soft text-accent" : "text-muted hover:bg-panel"}` : `h-8 w-8 rounded-lg border border-line bg-bg ${open ? "text-accent" : "text-muted"}`}`}
      >
        <Bell size={15} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.6rem] text-white">{unread > 99 ? "99+" : unread}</span>
        )}
      </button>
      {open && (
        <div className={`absolute z-50 w-96 overflow-hidden rounded-xl border border-line bg-panel shadow-xl ${rail ? "bottom-0 left-full ml-2" : "right-0 top-10"}`}>
          <div className="flex items-center border-b border-line px-3 py-2">
            <span className="text-sm font-medium">Bot notifications</span>
            {unread > 0 && (
              <button onClick={() => void read({ all: true })} className="ml-auto text-xs text-muted hover:text-accent">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[70vh] overflow-y-auto scroll-thin">
            {list.length === 0 && <p className="px-4 py-6 text-center text-xs text-muted">Nothing yet. When a bot finds or finishes something, it shows up here.</p>}
            {list.map((n) => (
              <button key={n.id} onClick={() => go(n)} className={`flex w-full gap-2.5 border-b border-line px-3 py-2.5 text-left last:border-0 hover:bg-sunken ${n.read ? "" : "bg-accent-soft/30"}`}>
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[0.7rem] text-accent">{n.avatar || n.botName[0]}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[0.7rem] text-muted">
                    {n.botName} · {ago(n.at)}
                    {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                  </span>
                  <span className="block text-sm leading-snug">{n.title}</span>
                  {n.body && <span className="mt-0.5 line-clamp-2 text-xs text-muted">{n.body}</span>}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
