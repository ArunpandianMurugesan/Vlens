"use client";

import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Gauge,
  GitBranch,
  Layers,
  Lightbulb,
  Loader2,
  Menu,
  Minimize2,
  Plus,
  RefreshCw,
  Sparkles,
  Table2,
  User,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { TreeChat } from "@/hooks/useTreeChat";
import type { DashboardData, DayStats, HeavySession } from "@/lib/types";
import { Ring } from "./Usage";

const fmt = (n: number) =>
  n >= 1e9 ? `${+(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);

function until(unixSec: number) {
  const s = unixSec - Date.now() / 1000;
  if (s <= 0) return "now";
  if (s < 3600) return `${Math.ceil(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function Card({ title, icon: Icon, action, children, className = "" }: { title: string; icon: typeof User; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-panel p-4 ${className}`}>
      <div className="mb-3 flex items-center gap-2">
        <Icon size={15} className="text-accent" />
        <h2 className="text-sm font-medium">{title}</h2>
        <div className="ml-auto">{action}</div>
      </div>
      {children}
    </section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-panel px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
    </div>
  );
}

// ── Activity chart (one series at a time; hover a bar for its numbers) ──

type Metric = "tokensSent" | "prompts";
const METRICS: { id: Metric; label: string; hint: string }[] = [
  { id: "tokensSent", label: "Tokens read", hint: "context Claude read to write its replies" },
  { id: "prompts", label: "Messages", hint: "messages you sent" },
];

function ActivityChart({ days }: { days: { date: string; stats: DayStats }[] }) {
  const [metric, setMetric] = useState<Metric>("tokensSent");
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const vals = days.map((d) => d.stats[metric]);
  const max = Math.max(1, ...vals);
  // A tidy top for the grid: 1, 2 or 5 times a power of ten.
  const mag = 10 ** Math.floor(Math.log10(max));
  const top = [1, 2, 5, 10].map((m) => m * mag).find((t) => t >= max)!;
  // Wide and short, so it stays a strip on big screens.
  const W = 1000, H = 190, L = 44, B = 22, T = 8;
  const bw = (W - L) / days.length;
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const label = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
  const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const m = METRICS.find((x) => x.id === metric)!;

  return (
    <Card
      title="Activity, last 14 days"
      icon={Activity}
      action={
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-sunken p-0.5 text-xs" role="radiogroup" aria-label="Metric">
            {METRICS.map((x) => (
              <button key={x.id} role="radio" aria-checked={metric === x.id} onClick={() => setMetric(x.id)} className={`rounded-md px-2 py-0.5 ${metric === x.id ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                {x.label}
              </button>
            ))}
          </div>
          <button onClick={() => setAsTable((t) => !t)} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink" title={asTable ? "Show chart" : "Show as table"} aria-label="Toggle table view">
            <Table2 size={14} />
          </button>
        </div>
      }
    >
      <p className="-mt-1 mb-2 text-xs text-muted">{m.label}: {m.hint}, per day.</p>
      {asTable ? (
        <table className="w-full text-xs">
          <thead className="text-muted">
            <tr><th className="py-1 text-left font-normal">Day</th><th className="text-right font-normal">Messages</th><th className="text-right font-normal">Replies</th><th className="text-right font-normal">Tool calls</th><th className="text-right font-normal">Tokens read</th><th className="text-right font-normal">Tokens written</th></tr>
          </thead>
          <tbody className="tabular-nums">
            {[...days].reverse().map((d) => (
              <tr key={d.date} className="border-t border-line">
                <td className="py-1">{label(d.date)}</td><td className="text-right">{d.stats.prompts}</td><td className="text-right">{d.stats.replies}</td><td className="text-right">{d.stats.toolCalls}</td><td className="text-right">{fmt(d.stats.tokensSent)}</td><td className="text-right">{fmt(d.stats.tokensWritten)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${m.label} per day for the last 14 days`} onMouseLeave={() => setHover(null)}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={L} x2={W} y1={y(top * f)} y2={y(top * f)} className="stroke-line" strokeWidth={1} />
                <text x={L - 6} y={y(top * f) + 3} textAnchor="end" className="fill-muted text-[10px]">{fmt(top * f)}</text>
              </g>
            ))}
            {days.map((d, i) => {
              const v = vals[i];
              const x = L + i * bw + 2; // 2px gap between bars
              const w = Math.max(2, bw - 4);
              const h = Math.max(0, y(0) - y(v));
              const r = Math.min(4, w / 2, h);
              return (
                <g key={d.date} onMouseEnter={() => setHover(i)}>
                  {/* Hit area taller and wider than the bar */}
                  <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
                  {v > 0 && (
                    <path
                      d={`M${x},${y(0)} v${-(h - r)} q0,${-r} ${r},${-r} h${w - 2 * r} q${r},0 ${r},${r} v${h - r} z`}
                      fill="var(--chart)"
                      opacity={hover === null || hover === i ? 1 : 0.45}
                    />
                  )}
                  {(i % 2 === days.length % 2 || i === days.length - 1) && (
                    <text x={L + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="fill-muted text-[10px]">
                      {i === days.length - 1 ? "Today" : short(d.date)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs shadow-lg"
              style={{ left: `${((L + hover * bw + bw / 2) / W) * 100}%` }}
            >
              <div className="font-medium">{label(days[hover].date)}</div>
              <div className="tabular-nums text-muted">
                {days[hover].stats.prompts} messages · {fmt(days[hover].stats.tokensSent)} tokens read · {fmt(days[hover].stats.tokensWritten)} written
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Context health ──

function HeavyRow({ h, chat, onDone }: { h: HeavySession; chat: TreeChat; onDone: () => void }) {
  const [busy, setBusy] = useState<"compact" | "fresh" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pct = h.used / h.window;
  const blocked = h.active ? `Open in ${h.activeWhere === "desktop" ? "the desktop app" : "a terminal"}. Use /compact there, or close it first.` : null;

  const run = async (action: "compact" | "handoff") => {
    setBusy(action === "compact" ? "compact" : "fresh");
    setErr(null);
    try {
      const res = await fetch(`/api/sessions/${h.id}/context`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? res.statusText);
      if (action === "handoff") {
        // Start a new session in the same folder from the handoff note.
        const intro = `Continuing from an earlier session ("${h.title}"). Here's the handoff note it wrote:\n\n${d.note}\n\nRead it, check the current state of the code if you need to, then tell me briefly where things stand and what you'd do next.`;
        void chat.sendRoot(intro, "acceptEdits", undefined, [], d.cwd ?? h.cwd ?? undefined);
      } else onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  };

  const btn = "inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-line disabled:hover:text-inherit";
  return (
    <li className="border-t border-line py-2.5 first:border-t-0">
      <div className="flex items-center gap-3">
        <div className="relative">
          <Ring pct={pct} size={34} stroke={4} />
          <span className="absolute inset-0 flex items-center justify-center text-[0.6rem] font-medium tabular-nums">{Math.round(pct * 100)}%</span>
        </div>
        <div className="min-w-0 flex-1">
          <button onClick={() => chat.selectSession(h.id)} className="block max-w-full truncate text-left text-sm hover:text-accent">
            {h.title}
          </button>
          <div className="truncate text-xs text-muted">
            {h.projectName} · {fmt(h.used)} of {fmt(h.window)}{h.estimated ? " (est.)" : ""} per reply · {h.replies} replies
            {h.compactions ? ` · compacted ${h.compactions}×` : ""} · {ago(h.updatedAt)}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <button className={btn} disabled={!!busy || !!blocked} title={blocked ?? "Summarize this conversation in place (/compact)"} onClick={() => run("compact")}>
            {busy === "compact" ? <Loader2 size={12} className="animate-spin" /> : <Minimize2 size={12} />} Compact
          </button>
          <button className={btn} disabled={!!busy || !!blocked} title={blocked ?? "Write a handoff note, then start a new session in the same folder from it"} onClick={() => run("handoff")}>
            {busy === "fresh" ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Fresh start
          </button>
        </div>
      </div>
      {busy && <p className="mt-1.5 pl-[46px] text-xs text-muted">{busy === "compact" ? "Compacting… this can take a minute on a long session." : "Writing a handoff note… then a new session opens."}</p>}
      {err && <p className="mt-1.5 pl-[46px] text-xs text-red-600">{err}</p>}
    </li>
  );
}

function ContextHealth({ data, chat, reload }: { data: DashboardData; chat: TreeChat; reload: () => void }) {
  const today = data.days.at(-1)!.stats;
  const ratio = today.tokensWritten ? Math.round(today.tokensSent / today.tokensWritten) : 0;
  return (
    <Card title="Context health" icon={Gauge} className="lg:col-span-2">
      <div className="mb-3 rounded-xl bg-sunken px-3 py-2.5 text-sm">
        {today.tokensSent > 0 ? (
          <>
            Today Claude <b>read {fmt(today.tokensSent)} tokens</b> to <b>write {fmt(today.tokensWritten)}</b>
            {ratio > 1 && <> (about <b>{ratio}×</b> more)</>}. Almost all of that is conversation history:{" "}
          </>
        ) : (
          <>Why sessions get expensive: </>
        )}
        every reply re-sends the <i>whole</i> session so far. A session at 300k tokens costs ~300k on every message, so the longest sessions use up your 5-hour limit fastest.
      </div>
      {data.heavy.length ? (
        <ul>
          {data.heavy.map((h) => (
            <HeavyRow key={h.id} h={h} chat={chat} onDone={reload} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No sessions from this week yet.</p>
      )}
      <p className="mt-2 text-xs text-muted">
        <b>Compact</b> squeezes a session into a summary and keeps going. <b>Fresh start</b> has Claude write a handoff note, then opens a new session in the same folder that starts from it.
        {data.autoCompact ? " Auto-compact is on, so the CLI also compacts by itself when a window is nearly full." : " Auto-compact is off in your Claude Code settings."}
      </p>
    </Card>
  );
}

const TIPS: { icon: typeof User; title: string; body: string }[] = [
  { icon: Layers, title: "One task, one session", body: "Start a new session for each feature or bug. Use Fresh start to carry the important bits over instead of continuing forever." },
  { icon: Sparkles, title: "Side questions in a sub-agent", body: "Select text and Ask Sub-Agent. It runs in its own session, so the main conversation doesn't grow." },
  { icon: Minimize2, title: "Compact at about half full", body: "Past ~50%, run /compact (or the button above) before the next big step. A small summary beats a huge history." },
  { icon: BadgeCheck, title: "Keep lasting facts in CLAUDE.md", body: "Project rules, commands and conventions in CLAUDE.md or memory load into every new session, so a fresh start isn't starting from zero." },
];

// ── Page ──

export function HomeView({ chat, onMenu, onNew, onReview }: { chat: TreeChat; onMenu: () => void; onNew: () => void; onReview: () => void }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetch("/api/dashboard").then((r) => r.json()));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const a = data?.account;
  const w = data?.limits.windows;
  const today = data?.days.at(-1)?.stats;
  const greeting = (() => {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  })();

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button onClick={onMenu} className="text-muted md:hidden" aria-label="Open sidebar">
          <Menu size={20} />
        </button>
        <h1 className="flex-1 font-medium">Home</h1>
        <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent disabled:opacity-60">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-2xl font-semibold">{greeting}{a?.email ? `, ${a.email.split("@")[0]}` : ""}</div>
              <p className="text-sm text-muted">Here&apos;s how your Claude Code is doing.</p>
            </div>
            <button onClick={onNew} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-medium text-white">
              <Plus size={15} /> New session
            </button>
            <button onClick={onReview} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm hover:border-accent hover:text-accent">
              <GitBranch size={15} /> Lens Review <ArrowRight size={13} />
            </button>
          </div>

          {!data ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted">
              <Loader2 size={16} className="animate-spin" /> Reading your sessions…
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Tile label="Running now" value={String(data.counts.active)} sub={`${data.counts.sessions} sessions in total`} />
                <Tile label="Used this week" value={String(data.counts.thisWeek)} sub="sessions" />
                <Tile label="Messages today" value={String(today?.prompts ?? 0)} sub={`${today?.toolCalls ?? 0} tool calls`} />
                <Tile label="Tokens read today" value={fmt(today?.tokensSent ?? 0)} sub={`${fmt(today?.tokensWritten ?? 0)} written`} />
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="Signed in" icon={User}>
                  {a?.loggedIn ? (
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                      <dt className="text-muted">Account</dt>
                      <dd className="truncate">{a.email}</dd>
                      {a.orgName && (
                        <>
                          <dt className="text-muted">Org</dt>
                          <dd className="truncate">{a.orgName}</dd>
                        </>
                      )}
                      {a.plan && (
                        <>
                          <dt className="text-muted">Plan</dt>
                          <dd className="capitalize">{a.plan}</dd>
                        </>
                      )}
                      {a.method && (
                        <>
                          <dt className="text-muted">Via</dt>
                          <dd>{a.method}</dd>
                        </>
                      )}
                    </dl>
                  ) : (
                    <p className="text-sm text-muted">Claude Code isn&apos;t signed in. Open Settings → Account to sign in.</p>
                  )}
                </Card>

                <Card title="Usage limits" icon={Gauge} className="lg:col-span-2">
                  {w ? (
                    <div className="flex flex-wrap gap-8">
                      {(
                        [
                          ["5-hour", w.fiveHour],
                          ["Weekly", w.sevenDay],
                        ] as const
                      ).map(([label, win]) =>
                        win ? (
                          <div key={label} className="flex items-center gap-3">
                            <div className="relative">
                              <Ring pct={win.utilization} size={56} stroke={6} />
                              <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">{Math.round(win.utilization * 100)}%</span>
                            </div>
                            <div>
                              <div className="text-sm font-medium">{label} limit</div>
                              <div className="text-xs text-muted">resets in {until(win.resetsAt)}</div>
                            </div>
                          </div>
                        ) : null,
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-muted">No usage data yet. It shows up after the first Claude run in Lens.</p>
                  )}
                </Card>
              </div>

              <ActivityChart days={data.days} />

              <div className="grid gap-4 lg:grid-cols-3">
                <ContextHealth data={data} chat={chat} reload={load} />
                <Card title="Keep sessions light" icon={Lightbulb}>
                  <ul className="space-y-3">
                    {TIPS.map((t) => (
                      <li key={t.title} className="flex gap-2.5">
                        <t.icon size={14} className="mt-0.5 shrink-0 text-accent" />
                        <div>
                          <div className="text-sm font-medium">{t.title}</div>
                          <div className="text-xs text-muted">{t.body}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
