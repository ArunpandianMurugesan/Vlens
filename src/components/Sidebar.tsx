"use client";

import {
  AlertTriangle,
  FolderOpen,
  MessagesSquare,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Power,
  Search,
  Settings as SettingsIcon,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Review } from "@/hooks/useReview";
import type { TreeChat } from "@/hooks/useTreeChat";
import { ReviewSidebar } from "./ReviewSidebar";
import { ContextBadge, PlanUsage } from "./Usage";
import type { SessionSummary } from "@/lib/types";

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StatusDot({ s }: { s: SessionSummary }) {
  if (!s.active) return null;
  const where = s.active.entrypoint === "desktop" ? "desktop app" : "terminal";
  return s.active.status === "busy" ? (
    <span title={`Working (${where})`} className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
  ) : (
    <span title={`Open, waiting for you (${where})`} className="h-2 w-2 shrink-0 rounded-full border border-emerald-500" />
  );
}

type Actions = Pick<
  TreeChat,
  | "renameSession"
  | "pinSession"
  | "forgetRecent"
  | "endSession"
  | "deleteSession"
  | "limits"
  | "refreshingLimits"
  | "refreshLimits"
  | "crashed"
  | "handleCrashed"
  | "restoredNote"
  | "clearRestoredNote"
>;

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  settingsOpen: boolean;
  tab: "sessions" | "review";
  onTab: (t: "sessions" | "review") => void;
  review: Review;
  onPickPr: (url: string) => void;
  actions: Actions;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onNew,
  onSettings,
  settingsOpen,
  tab,
  onTab,
  review,
  onPickPr,
  actions,
  open,
  onClose,
}: Props) {
  const needsYou = review.prs.filter((p) => p.lane === "needsYou").length;
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  // The bar shows running sessions, pinned ones, and the one you have open
  // (so you can still end and delete it after it stops).
  const matches = (s: SessionSummary) =>
    !q || s.title.toLowerCase().includes(q.toLowerCase()) || s.projectName.toLowerCase().includes(q.toLowerCase());
  // Stable order, so items don't jump around while you use them.
  const pinned = sessions
    .filter((s) => s.pinOrder !== undefined && matches(s))
    .sort((a, b) => a.pinOrder! - b.pinOrder!);
  const active = sessions
    .filter((s) => s.pinOrder === undefined && (s.active || s.id === activeId) && matches(s))
    .sort((a, b) => (b.active?.startedAt ?? Infinity) - (a.active?.startedAt ?? Infinity));
  // Sessions Lens started or replied in lately. Their `claude -p` process exits
  // after each reply, so without this they'd vanish when you switch away.
  const recent = sessions
    .filter((s) => s.pinOrder === undefined && !s.active && s.id !== activeId && s.recentAt && matches(s))
    .sort((a, b) => b.recentAt!.localeCompare(a.recentAt!));

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const item = (s: SessionSummary) => (
    <SessionItem
      key={s.id}
      s={s}
      selected={s.id === activeId}
      onSelect={() => {
        onSelect(s.id);
        onClose();
      }}
      actions={actions}
      run={run}
    />
  );

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-30 bg-black/30 transition-opacity md:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-line bg-sunken transition-transform md:static md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 px-4 pb-3 pt-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
            <MessagesSquare size={15} />
          </div>
          <span className="font-semibold">Claude Lens</span>
          <button onClick={onClose} className="ml-auto text-muted md:hidden" aria-label="Close sidebar">
            <X size={18} />
          </button>
        </div>

        {/* Sessions | Lens Review */}
        <div className="mx-3 mb-2 flex rounded-lg bg-panel p-0.5 text-xs">
          {(
            [
              ["sessions", "Sessions"],
              ["review", "Lens Review"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => onTab(id)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 transition ${
                tab === id && !settingsOpen ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {label}
              {id === "review" && needsYou > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 text-[0.65rem] font-medium leading-4 text-white" title={`${needsYou} PR${needsYou === 1 ? "" : "s"} need your review`}>
                  {needsYou}
                </span>
              )}
            </button>
          ))}
        </div>

        {tab === "review" ? (
          <ReviewSidebar
            review={review}
            onPick={(url) => {
              onPickPr(url);
              onClose();
            }}
          />
        ) : (
          <>
        <div className="space-y-2 px-3">
          <button
            onClick={() => {
              onNew();
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm font-medium hover:border-accent hover:text-accent"
          >
            <Plus size={15} /> New session
          </button>
          <label className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm">
            <Search size={14} className="text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search sessions"
              className="w-full bg-transparent outline-none placeholder:text-muted"
            />
          </label>
        </div>

        <nav className="mt-3 flex-1 overflow-y-auto px-2 pb-4 scroll-thin">
          <CrashedBanner actions={actions} run={run} />
          {pinned.length > 0 && (
            <>
              <Heading>Pinned</Heading>
              <div className="mb-3 space-y-0.5">{pinned.map(item)}</div>
            </>
          )}
          <Heading>Active</Heading>
          <div className="space-y-0.5">{active.map(item)}</div>
          {active.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-muted">
              {q ? "No matches" : "No running sessions. Start one in a terminal or with New session."}
            </p>
          )}
          {recent.length > 0 && (
            <>
              <div className="mt-3" />
              <Heading>Recent</Heading>
              <div className="space-y-0.5">{recent.map(item)}</div>
            </>
          )}
        </nav>
          </>
        )}

        <button
          onClick={() => {
            onSettings();
            onClose();
          }}
          className={`mx-2 mb-1 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
            settingsOpen ? "bg-panel text-ink shadow-sm" : "text-muted hover:bg-panel/60 hover:text-ink"
          }`}
        >
          <SettingsIcon size={14} /> Settings
        </button>
        <PlanUsage limits={actions.limits} refreshing={actions.refreshingLimits} onRefresh={actions.refreshLimits} />

        {error && (
          <div className="m-2 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-600">
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss">
              <X size={13} />
            </button>
          </div>
        )}
      </aside>
    </>
  );
}

// Sessions whose process stopped unexpectedly (crash, reboot), with one-click restore.
function CrashedBanner({ actions, run }: { actions: Actions; run: (fn: () => Promise<void>) => Promise<void> }) {
  const { crashed, restoredNote } = actions;
  const [opening, setOpening] = useState<string | null>(null);
  const restore = async (key: string) => {
    setOpening(key);
    await run(() => actions.handleCrashed(key, "restore"));
    setOpening(null);
  };
  if (restoredNote.length)
    return (
      <div className="mb-3 flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
        <span className="flex-1">
          Reopened {restoredNote.length === 1 ? `“${restoredNote[0]}”` : `${restoredNote.length} sessions`} in a new terminal window.
        </span>
        <button onClick={actions.clearRestoredNote} aria-label="Dismiss">
          <X size={13} />
        </button>
      </div>
    );
  if (!crashed.length) return null;
  return (
    <div className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
      <div className="mb-1.5 flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle size={13} /> {crashed.length === 1 ? "A session" : `${crashed.length} sessions`} stopped unexpectedly
      </div>
      <ul className="mb-2 space-y-0.5">
        {crashed.slice(0, 4).map((c) => (
          <li key={c.key} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate" title={c.cwd}>
              {c.title}
            </span>
            <button className="text-accent hover:underline disabled:opacity-60" disabled={!!opening} onClick={() => restore(c.key)}>
              {opening === c.key || opening === "all" ? "Opening…" : "Restore"}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-3">
        {crashed.length > 1 && (
          <button className="font-medium text-accent hover:underline" disabled={!!opening} onClick={() => restore("all")}>
            Restore all
          </button>
        )}
        <button className="text-muted hover:underline" onClick={() => run(() => actions.handleCrashed("all", "dismiss"))}>
          Dismiss
        </button>
      </div>
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="px-2.5 pb-1 text-[0.68rem] font-medium uppercase tracking-wide text-muted">{children}</div>;
}

type Confirm = "end" | "delete" | null;

function SessionItem({
  s,
  selected,
  onSelect,
  actions,
  run,
}: {
  s: SessionSummary;
  selected: boolean;
  onSelect: () => void;
  actions: Actions;
  run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(s.title);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close the menu on any click outside this item.
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setMenu(false);
        setConfirm(null);
      }
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [menu]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    await run(fn);
    setBusy(false);
    setMenu(false);
    setConfirm(null);
  };

  const saveName = async () => {
    setRenaming(false);
    const t = name.trim();
    if (t && t !== s.title) await run(() => actions.renameSession(s.id, t));
    else setName(s.title);
  };

  const canEnd = s.active?.entrypoint === "cli";
  const menuItem = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-sunken disabled:opacity-40";

  return (
    <div ref={ref} className="group relative">
      {renaming ? (
        <div className="rounded-lg bg-panel px-2.5 py-2 shadow-sm">
          <input
            autoFocus
            onFocus={(e) => e.currentTarget.select()} // typing replaces the old name
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setName(s.title);
                setRenaming(false);
              }
            }}
            className="w-full rounded border border-accent bg-bg px-1.5 py-0.5 text-sm outline-none"
          />
        </div>
      ) : (
        <button
          onClick={onSelect}
          className={`w-full rounded-lg px-2.5 py-2 pr-8 text-left transition ${selected ? "bg-panel shadow-sm" : "hover:bg-panel/60"}`}
        >
          <div className="flex items-start gap-2">
            <div className="line-clamp-2 flex-1 text-sm leading-snug">{s.title}</div>
            <span className="mt-1.5 flex">
              <StatusDot s={s} />
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[0.7rem] text-muted">
            <FolderOpen size={11} />
            <span className="truncate">{s.projectName}</span>
            {!s.active && <span className="shrink-0 rounded bg-sunken px-1">stopped</span>}
            <span className="ml-auto flex shrink-0 items-center gap-2">
              <ContextBadge ctx={s.context} compact />
              {ago(s.updatedAt)}
            </span>
          </div>
        </button>
      )}

      {!renaming && (
        <button
          onClick={() => {
            setMenu((m) => !m);
            setConfirm(null);
          }}
          aria-label="Session actions"
          className={`absolute right-1.5 top-1.5 rounded-md p-1 text-muted hover:bg-sunken hover:text-ink ${
            menu ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100"
          }`}
        >
          <MoreHorizontal size={15} />
        </button>
      )}

      {menu && (
        <div className="absolute right-1.5 top-8 z-50 w-56 overflow-hidden rounded-lg border border-line bg-panel py-1 shadow-xl">
          {confirm === "end" ? (
            <ConfirmBox
              text="End the running Claude process for this session? Whatever it's doing in that terminal stops."
              action="End session"
              busy={busy}
              onYes={() => act(() => actions.endSession(s.id))}
              onNo={() => setConfirm(null)}
            />
          ) : confirm === "delete" ? (
            <ConfirmBox
              text="Delete this session? Its files move to data/trash in this app, so you can get them back."
              action="Delete"
              busy={busy}
              onYes={() => act(() => actions.deleteSession(s.id))}
              onNo={() => setConfirm(null)}
            />
          ) : (
            <>
              <button
                className={menuItem}
                onClick={() => {
                  setMenu(false);
                  setName(s.title);
                  setRenaming(true);
                }}
              >
                <Pencil size={13} /> Rename
              </button>
              <button className={menuItem} onClick={() => act(() => actions.pinSession(s.id, s.pinOrder === undefined))}>
                {s.pinOrder !== undefined ? <PinOff size={13} /> : <Pin size={13} />}{" "}
                {s.pinOrder !== undefined ? "Unpin" : "Pin"}
              </button>
              {s.recentAt && !s.active && s.pinOrder === undefined && (
                <button className={menuItem} onClick={() => act(() => actions.forgetRecent(s.id))}>
                  <X size={13} /> Remove from Recent
                </button>
              )}
              {s.active && (
                <button
                  className={menuItem}
                  disabled={!canEnd}
                  title={canEnd ? undefined : "This session runs in the desktop app. End it there."}
                  onClick={() => setConfirm("end")}
                >
                  <Power size={13} /> End session
                </button>
              )}
              <button
                className={`${menuItem} text-red-600`}
                disabled={!!s.active}
                title={s.active ? "End the session first" : undefined}
                onClick={() => setConfirm("delete")}
              >
                <Trash2 size={13} /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ConfirmBox(p: { text: string; action: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  return (
    <div className="space-y-2 px-3 py-2 text-xs">
      <p className="text-muted">{p.text}</p>
      <div className="flex justify-end gap-1.5">
        <button onClick={p.onNo} className="rounded-md px-2 py-1 hover:bg-sunken">
          Cancel
        </button>
        <button
          onClick={p.onYes}
          disabled={p.busy}
          className="rounded-md bg-red-600 px-2 py-1 font-medium text-white disabled:opacity-50"
        >
          {p.busy ? "…" : p.action}
        </button>
      </div>
    </div>
  );
}
