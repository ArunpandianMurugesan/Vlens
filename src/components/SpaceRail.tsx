"use client";

import { Bot, GitPullRequest, MessagesSquare, Settings as SettingsIcon, Store } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Limits } from "@/lib/types";
import { BotBell } from "./BotBell";
import { PlanUsage, Ring } from "./Usage";

// The thin bar on the far left: which space you're in (each loads its own
// data when you open it), and at the bottom what's shared by all of them:
// Marketplace, Settings and your plan's usage.
export type Space = "bots" | "sessions" | "review";

const SPACES: { id: Space; label: string; Icon: typeof Bot }[] = [
  { id: "bots", label: "Bots", Icon: Bot },
  { id: "sessions", label: "Sessions", Icon: MessagesSquare },
  { id: "review", label: "Vlens Review", Icon: GitPullRequest },
];

interface Props {
  space: Space | null; // null: on a shared page (Settings, Marketplace)
  onSpace: (s: Space) => void;
  badge?: Partial<Record<Space, number>>;
  page: "settings" | "marketplace" | null;
  onSettings: () => void;
  onMarketplace: () => void;
  limits: Limits | null;
  refreshingLimits: boolean;
  onRefreshLimits: () => void;
}

const item = (on: boolean) =>
  `relative flex h-9 w-9 items-center justify-center rounded-xl transition ${on ? "bg-accent-soft text-accent" : "text-muted hover:bg-panel hover:text-ink"}`;

export function SpaceRail(p: Props) {
  const [usage, setUsage] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Close the usage card on a click anywhere else.
  useEffect(() => {
    if (!usage) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setUsage(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [usage]);
  const w = p.limits?.windows;
  const most = Math.max(w?.fiveHour?.utilization ?? 0, w?.sevenDay?.utilization ?? 0);

  return (
    <nav className="hidden w-12 shrink-0 flex-col items-center gap-1.5 border-r border-line bg-sunken/60 py-3 md:flex" aria-label="Spaces">
      {SPACES.map(({ id, label, Icon }) => (
        <button key={id} onClick={() => p.onSpace(id)} title={label} aria-label={label} aria-current={p.space === id} className={item(p.space === id)}>
          <Icon size={18} />
          {!!p.badge?.[id] && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[0.6rem] text-white">{p.badge[id]}</span>
          )}
        </button>
      ))}
      <div className="flex-1" />
      <BotBell rail />
      <button onClick={p.onMarketplace} title="Marketplace" aria-label="Marketplace" className={item(p.page === "marketplace")}>
        <Store size={17} />
      </button>
      <button onClick={p.onSettings} title="Settings" aria-label="Settings" className={item(p.page === "settings")}>
        <SettingsIcon size={17} />
      </button>
      <div ref={box} className="relative">
        <button
          onClick={() => setUsage((u) => !u)}
          title={w ? `Usage: 5h ${Math.round((w.fiveHour?.utilization ?? 0) * 100)}% · 7d ${Math.round((w.sevenDay?.utilization ?? 0) * 100)}%` : "Usage limits"}
          aria-label="Usage limits"
          className={item(usage)}
        >
          <Ring pct={most} size={18} stroke={2.5} />
        </button>
        {usage && (
          <div className="absolute bottom-0 left-full z-50 ml-2 w-72 overflow-hidden rounded-xl border border-line bg-panel shadow-xl [&>div]:border-t-0">
            <PlanUsage limits={p.limits} refreshing={p.refreshingLimits} onRefresh={p.onRefreshLimits} />
          </div>
        )}
      </div>
    </nav>
  );
}
