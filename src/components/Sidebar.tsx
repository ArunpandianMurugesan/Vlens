"use client";

import { FolderOpen, MessagesSquare, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { SessionSummary } from "@/lib/types";

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface Props {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ sessions, activeId, onSelect, open, onClose }: Props) {
  const [q, setQ] = useState("");
  const [project, setProject] = useState<string | null>(null);

  const projects = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of sessions) m.set(s.projectName, (m.get(s.projectName) ?? 0) + 1);
    return [...m.entries()];
  }, [sessions]);

  const filtered = sessions.filter(
    (s) =>
      (!project || s.projectName === project) &&
      (!q || s.title.toLowerCase().includes(q.toLowerCase()) || s.projectName.toLowerCase().includes(q.toLowerCase())),
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

        <div className="px-3">
          <label className="flex items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm">
            <Search size={14} className="text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search sessions"
              className="w-full bg-transparent outline-none placeholder:text-muted"
            />
          </label>
          <select
            value={project ?? ""}
            onChange={(e) => setProject(e.target.value || null)}
            className="mt-2 w-full rounded-lg border border-line bg-panel px-2 py-1.5 text-sm text-muted outline-none"
          >
            <option value="">All projects ({sessions.length})</option>
            {projects.map(([p, n]) => (
              <option key={p} value={p}>
                {p} ({n})
              </option>
            ))}
          </select>
        </div>

        <nav className="mt-3 flex-1 space-y-0.5 overflow-y-auto px-2 pb-4 scroll-thin">
          {filtered.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                onSelect(s.id);
                onClose();
              }}
              className={`group w-full rounded-lg px-2.5 py-2 text-left transition ${
                s.id === activeId ? "bg-panel shadow-sm" : "hover:bg-panel/60"
              }`}
            >
              <div className="line-clamp-2 text-sm leading-snug">{s.title}</div>
              <div className="mt-1 flex items-center gap-1.5 text-[0.7rem] text-muted">
                <FolderOpen size={11} />
                <span className="truncate">{s.projectName}</span>
                <span className="ml-auto shrink-0">{ago(s.updatedAt)}</span>
              </div>
            </button>
          ))}
          {filtered.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">No sessions</p>}
        </nav>
      </aside>
    </>
  );
}
