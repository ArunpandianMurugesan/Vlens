"use client";

import { RefreshCw } from "lucide-react";
import type { ContextUsage, LimitWindow, Limits } from "@/lib/types";

// Green until half used, amber until 80%, then red.
function tone(pct: number) {
  return pct < 0.5 ? "stroke-emerald-500" : pct < 0.8 ? "stroke-amber-500" : "stroke-red-500";
}

export function Ring({ pct, size = 22, stroke = 3 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.min(Math.max(pct, 0), 1);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-line" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${p * c} ${c}`}
        className={`transition-[stroke-dasharray] duration-500 ${tone(p)}`}
      />
    </svg>
  );
}

// "3h", "6d", "40m" until a unix-seconds time.
function until(unixSec: number) {
  const s = unixSec - Date.now() / 1000;
  if (s <= 0) return "now";
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function ago(iso: string) {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

const tokens = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`);

function Window({ label, w }: { label: string; w: LimitWindow | null }) {
  if (!w) return null;
  const pct = Math.round(w.utilization * 100);
  return (
    <div
      className="flex items-center gap-2"
      title={`${pct}% of your ${label === "5h" ? "5-hour" : "weekly"} limit used. Resets ${new Date(w.resetsAt * 1000).toLocaleString()}.`}
    >
      <Ring pct={w.utilization} />
      <div className="leading-tight">
        <div className="font-mono text-xs">
          {label} <span className="text-muted">resets {until(w.resetsAt)}</span>
        </div>
        <div className="text-[0.65rem] text-muted">{pct}% used</div>
      </div>
    </div>
  );
}

// Plan limits: the 5-hour and weekly windows.
export function PlanUsage({ limits, refreshing, onRefresh }: { limits: Limits | null; refreshing: boolean; onRefresh: () => void }) {
  const w = limits?.windows;
  return (
    <div className="border-t border-line px-3 py-3">
      <div className="mb-2 flex items-center text-[0.68rem] font-medium uppercase tracking-wide text-muted">
        Usage limits
        <button
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh (sends one tiny Claude request)"
          aria-label="Refresh usage"
          className="ml-auto rounded p-0.5 hover:bg-panel hover:text-ink disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
        </button>
      </div>
      {w ? (
        <>
          <div className="flex items-center justify-between gap-2">
            <Window label="5h" w={w.fiveHour} />
            <Window label="7d" w={w.sevenDay} />
          </div>
          {limits?.updatedAt && <div className="mt-1.5 text-[0.65rem] text-muted">Updated {ago(limits.updatedAt)}</div>}
        </>
      ) : (
        <div className="text-xs text-muted">{refreshing ? "Checking…" : "No data yet. Click refresh."}</div>
      )}
    </div>
  );
}

// How full a session's context window is.
export function ContextBadge({ ctx, compact }: { ctx?: ContextUsage; compact?: boolean }) {
  if (!ctx) return null;
  const pct = ctx.used / ctx.window;
  const label = `${ctx.estimated ? "~" : ""}${Math.round(pct * 100)}%`;
  const title = `Context: ${tokens(ctx.used)} of ${tokens(ctx.window)} tokens${ctx.estimated ? " (window size is a guess until Vlens sees this model)" : ""}`;
  return compact ? (
    <span title={title} className="flex shrink-0 items-center gap-1">
      <Ring pct={pct} size={11} stroke={2} />
      {label}
    </span>
  ) : (
    <span title={title} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs text-muted">
      <Ring pct={pct} size={14} stroke={2.5} />
      ctx {label}
      <span className="hidden opacity-70 lg:inline">
        · {tokens(ctx.used)}/{tokens(ctx.window)}
      </span>
    </span>
  );
}
