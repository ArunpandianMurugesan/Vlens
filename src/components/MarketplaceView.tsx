"use client";

import {
  ChevronRight,
  Download,
  Loader2,
  Menu,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Sparkles,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { TreeChat } from "@/hooks/useTreeChat";
import type { Marketplace, MarketplacePlugin, PluginDetail } from "@/lib/types";
import { Markdown } from "./Markdown";

const OFFICIAL = "claude-plugins-official";
const PAGE = 60;

async function post(body: object) {
  const res = await fetch("/api/marketplace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => null);
  if (!res.ok) throw new Error(d?.error ?? res.statusText);
}

const count = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(n));
const btn = "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";
const primary = "inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50";
const field = "rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent";

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange} className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${on ? "bg-accent" : "bg-line"}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function Fold({ title, children, open: start = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(start);
  return (
    <div className="border-t border-line">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 py-2 text-left text-xs font-medium text-muted hover:text-ink">
        <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} /> {title}
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

// ── One plugin, in full ──

function PluginPanel({ p, folders, onClose, onChanged }: { p: MarketplacePlugin; folders: string[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [detail, setDetail] = useState<PluginDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [scope, setScope] = useState<"user" | "project" | "local">("user");
  const [project, setProject] = useState(folders[0] ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null);
    setDetailErr(null);
    fetch(`/api/marketplace/details?id=${encodeURIComponent(p.id)}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setDetailErr(d.error) : setDetail(d)))
      .catch(() => setDetailErr("Couldn't load details."));
  }, [p.id]);

  const act = async (key: string, body: object) => {
    setBusy(key);
    setErr(null);
    try {
      await post(body);
      await onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  };

  const needsFolder = scope !== "user";
  const tokens = detail?.alwaysOnTokens ?? null;

  return (
    <aside className="flex h-full flex-col border-l border-line bg-panel">
      <div className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-medium">{p.name}</h2>
          <div className="truncate text-xs text-muted">
            {p.marketplace}
            {p.version && ` · v${p.version}`}
            {p.installCount !== null && ` · ${count(p.installCount)} installs`}
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Close">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 scroll-thin">
        {p.description && <p className="text-sm">{p.description}</p>}

        {/* Cost to every session's context: the same theme as Home → Context health */}
        <div className="rounded-xl bg-sunken px-3 py-2 text-xs">
          {detail ? (
            tokens === null ? (
              "Couldn't work out how much context it adds."
            ) : tokens === 0 ? (
              <>Adds <b>no</b> always-on context to your sessions.</>
            ) : (
              <>
                Adds about <b>{count(tokens)} tokens</b> to <b>every</b> session&apos;s context, before you type anything.
              </>
            )
          ) : detailErr ? (
            <span className="text-muted">{detailErr}</span>
          ) : (
            <span className="flex items-center gap-1.5 text-muted">
              <Loader2 size={12} className="animate-spin" /> Checking what&apos;s inside…
            </span>
          )}
        </div>

        {/* Install / manage */}
        {p.installs.length > 0 ? (
          <div className="space-y-2">
            {p.installs.map((i) => (
              <div key={`${i.scope}-${i.project}`} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div>Installed {i.scope === "user" ? "for all projects" : `for ${i.scope === "project" ? "a project (shared)" : "a project (only you)"}`}</div>
                  <div className="text-xs text-muted">{i.enabled ? "On" : "Off"}{i.version && ` · v${i.version}`}</div>
                </div>
                <Toggle
                  label={i.enabled ? "Turn off" : "Turn on"}
                  on={i.enabled}
                  disabled={!!busy}
                  onChange={() => act("toggle", { action: i.enabled ? "disable" : "enable", id: p.id, scope: i.scope, project: i.project ?? undefined })}
                />
                <button className={btn} disabled={!!busy} onClick={() => act("uninstall", { action: "uninstall", id: p.id, scope: i.scope, project: i.project ?? undefined })} aria-label="Uninstall">
                  {busy === "uninstall" ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                </button>
              </div>
            ))}
            <button className={btn} disabled={!!busy} onClick={() => act("update", { action: "update", id: p.id })}>
              {busy === "update" ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Update
            </button>
          </div>
        ) : (
          <div className="space-y-2 rounded-xl border border-line p-3">
            <div className="flex flex-wrap gap-2">
              <select className={`${field} min-w-0 flex-1`} value={scope} onChange={(e) => setScope(e.target.value as typeof scope)} aria-label="Install for">
                <option value="user">For all my projects</option>
                <option value="project">For one project, shared with the team</option>
                <option value="local">For one project, only me</option>
              </select>
              {needsFolder && (
                <select className={`${field} min-w-0 flex-1`} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
                  {folders.map((f) => (
                    <option key={f} value={f}>{f.split("/").filter(Boolean).pop()}</option>
                  ))}
                </select>
              )}
            </div>
            <button className={primary} disabled={!!busy || (needsFolder && !project)} onClick={() => act("install", { action: "install", id: p.id, scope, project: needsFolder ? project : undefined })}>
              {busy === "install" ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} Install
            </button>
            <p className="flex gap-1.5 text-[0.7rem] text-muted">
              <ShieldAlert size={12} className="mt-px shrink-0" />
              Plugins can run code on your Mac (hooks, MCP servers). Install only from sources you trust. Takes effect in new sessions.
            </p>
          </div>
        )}
        {err && <p className="whitespace-pre-wrap rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{err}</p>}

        {detail && (
          <div>
            {detail.skills.length > 0 && (
              <Fold title={`Skills (${detail.skills.length})`} open>
                <ul className="space-y-2">
                  {detail.skills.map((s) => (
                    <li key={s.name} className="flex gap-2">
                      <Sparkles size={12} className="mt-1 shrink-0 text-accent" />
                      <div className="min-w-0">
                        <div className="font-mono text-xs">{s.name}</div>
                        <div className="line-clamp-2 text-xs text-muted" title={s.description}>{s.description}</div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Fold>
            )}
            {detail.inventory && (
              <Fold title="Everything inside">
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-term p-2 font-mono text-[0.7rem] text-term-ink scroll-thin">{detail.inventory}</pre>
              </Fold>
            )}
            {detail.readme && (
              <Fold title="README">
                <Markdown text={detail.readme} />
              </Fold>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

// ── Page ──

export function MarketplaceView({ chat, onMenu }: { chat: TreeChat; onMenu: () => void }) {
  const [data, setData] = useState<{ plugins: MarketplacePlugin[]; marketplaces: Marketplace[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [market, setMarket] = useState<string>("");
  const [show, setShow] = useState<"all" | "installed" | "available">("all");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [source, setSource] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const folders = useMemo(() => [...new Set(chat.sessions.map((s) => s.cwd).filter((c): c is string => !!c))], [chat.sessions]);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const d = await fetch(`/api/marketplace${fresh ? "?fresh=1" : ""}`).then((r) => r.json());
      if (d.error) setError(d.error);
      else {
        setData(d);
        setError(null);
      }
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);
  useEffect(() => setLimit(PAGE), [q, market, show]);

  const refresh = async () => {
    setLoading(true);
    try {
      await post({ action: "refresh" }); // pull the latest catalogs
    } catch (e) {
      setError((e as Error).message);
    }
    await load(true);
  };

  const addMarket = async () => {
    setAddBusy(true);
    setAddErr(null);
    try {
      await post({ action: "addMarketplace", source });
      setAdding(false);
      setSource("");
      await load(true);
    } catch (e) {
      setAddErr((e as Error).message);
    }
    setAddBusy(false);
  };

  const plugins = useMemo(() => data?.plugins ?? [], [data]); // ~4k entries: don't re-filter every render
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of plugins) m.set(p.marketplace, (m.get(p.marketplace) ?? 0) + 1);
    return m;
  }, [plugins]);
  // Marketplaces you added, plus built-in sources the CLI lists (Anthropic's
  // plugin directory, your skills folder), which can't be removed. Yours first;
  // the big built-in ones last.
  const builtIn = (name: string) => name === OFFICIAL || !(data?.marketplaces ?? []).some((m) => m.name === name);
  const markets: (Marketplace & { removable: boolean })[] = [
    ...(data?.marketplaces ?? []).map((m) => ({ ...m, removable: true })),
    ...[...counts.keys()]
      .filter((n) => !(data?.marketplaces ?? []).some((m) => m.name === n))
      .map((n) => ({ name: n, source: n === "skills-dir" ? "~/.claude/skills" : "built into Claude Code", location: null, removable: false })),
  ].sort((a, b) => Number(builtIn(a.name)) - Number(builtIn(b.name)) || a.name.localeCompare(b.name));
  const marketLabel = (n: string) => (n === "skills-dir" ? "your skills folder" : n);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    // Marketplaces you added yourself (your team's) rank above the big built-in catalogs.
    const mine = new Set((data?.marketplaces ?? []).map((m) => m.name).filter((n) => n !== OFFICIAL));
    return plugins
      .filter(
        (p) =>
          (!market || p.marketplace === market) &&
          (show === "all" || (show === "installed" ? p.installs.length > 0 : p.installs.length === 0)) &&
          (!needle || `${p.name} ${p.description} ${p.marketplace}`.toLowerCase().includes(needle)),
      )
      .sort(
        (a, b) =>
          Number(b.installs.length > 0) - Number(a.installs.length > 0) ||
          Number(!mine.has(a.marketplace)) - Number(!mine.has(b.marketplace)) ||
          (b.installCount ?? 0) - (a.installCount ?? 0) ||
          a.name.localeCompare(b.name),
      );
  }, [plugins, q, market, show, data?.marketplaces]);

  const sel = plugins.find((p) => p.id === selected) ?? null;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button onClick={onMenu} className="text-muted md:hidden" aria-label="Open sidebar">
          <Menu size={20} />
        </button>
        <h1 className="flex-1 font-medium">Marketplace</h1>
        <button className={btn} onClick={() => setAdding((a) => !a)}>
          <Plus size={12} /> Add marketplace
        </button>
        <button className={btn} onClick={refresh} disabled={loading} title="Pull the latest catalogs">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto max-w-4xl space-y-3 px-4 py-4">
            {adding && (
              <div className="space-y-2 rounded-2xl border border-line bg-panel p-3">
                <div className="text-sm font-medium">Add a marketplace</div>
                <p className="text-xs text-muted">A GitHub repo (owner/repo), a git or https URL, or a folder that has a .claude-plugin/marketplace.json. Same as `claude plugin marketplace add`.</p>
                <div className="flex gap-2">
                  <input className={`${field} flex-1 font-mono`} placeholder="owner/repo" value={source} onChange={(e) => setSource(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addMarket()} autoFocus />
                  <button className={primary} disabled={addBusy || !source.trim()} onClick={addMarket}>
                    {addBusy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
                  </button>
                </div>
                {addErr && <p className="whitespace-pre-wrap text-xs text-red-600">{addErr}</p>}
              </div>
            )}

            {/* Which marketplace */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={() => setMarket("")} className={`rounded-full border px-2.5 py-1 text-xs ${!market ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink"}`}>
                All {plugins.length ? count(plugins.length) : ""}
              </button>
              {markets.map((m) => (
                <span key={m.name} className={`group inline-flex items-center rounded-full border text-xs ${market === m.name ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-ink"}`}>
                  <button onClick={() => setMarket(m.name)} className="py-1 pl-2.5 pr-1.5" title={m.source}>
                    <Store size={11} className="mr-1 inline" />
                    {marketLabel(m.name)} {counts.get(m.name) ? count(counts.get(m.name)!) : ""}
                  </button>
                  {!m.removable ? (
                    <span className="pr-1" />
                  ) : removing === m.name ? (
                    <button
                      className="pr-2 text-red-600"
                      onClick={async () => {
                        try {
                          await post({ action: "removeMarketplace", name: m.name });
                          if (market === m.name) setMarket("");
                          await load(true);
                        } catch (e) {
                          setError((e as Error).message);
                        }
                        setRemoving(null);
                      }}
                    >
                      Remove?
                    </button>
                  ) : (
                    <button onClick={() => setRemoving(m.name)} className="pr-2 opacity-0 group-hover:opacity-100" aria-label={`Remove ${m.name}`} title="Remove this marketplace">
                      <X size={11} />
                    </button>
                  )}
                </span>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm">
                <Search size={14} className="text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search plugins and skills" className="w-full bg-transparent outline-none placeholder:text-muted" />
              </label>
              <div className="flex rounded-lg bg-panel p-0.5 text-xs" role="radiogroup" aria-label="Show">
                {(["all", "installed", "available"] as const).map((s) => (
                  <button key={s} role="radio" aria-checked={show === s} onClick={() => setShow(s)} className={`rounded-md px-2.5 py-1 capitalize ${show === s ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink"}`}>
                    {s === "available" ? "Not installed" : s}
                  </button>
                ))}
              </div>
            </div>

            {error && <p className="whitespace-pre-wrap rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{error}</p>}
            {!data && !error && (
              <div className="flex items-center gap-2 py-8 text-sm text-muted">
                <Loader2 size={16} className="animate-spin" /> Loading catalogs…
              </div>
            )}

            <ul className="grid gap-2 sm:grid-cols-2">
              {shown.slice(0, limit).map((p) => {
                const on = p.installs.some((i) => i.enabled);
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => setSelected(p.id)}
                      className={`flex h-full w-full flex-col rounded-xl border px-3 py-2.5 text-left transition hover:border-accent ${selected === p.id ? "border-accent bg-accent-soft/40" : "border-line bg-panel"}`}
                    >
                      <div className="flex w-full items-center gap-2">
                        <Package size={14} className="shrink-0 text-accent" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                        {p.installs.length > 0 && (
                          <span className={`shrink-0 rounded-full px-1.5 text-[0.65rem] ${on ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-sunken text-muted"}`}>
                            {on ? "installed" : "installed · off"}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted">{p.description || "No description."}</p>
                      <div className="mt-auto flex gap-2 pt-1.5 text-[0.65rem] text-muted">
                        <span className="truncate">{p.marketplace}</span>
                        {p.version && <span>v{p.version}</span>}
                        {p.installCount !== null && <span className="ml-auto shrink-0">{count(p.installCount)} installs</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            {data && shown.length === 0 && <p className="py-6 text-center text-sm text-muted">No plugins match.</p>}
            {shown.length > limit && (
              <div className="flex justify-center">
                <button className={btn} onClick={() => setLimit((l) => l + PAGE)}>
                  Show more ({count(shown.length - limit)} left)
                </button>
              </div>
            )}
          </div>
        </div>

        {sel && (
          <div className="fixed inset-0 z-40 bg-bg md:static md:z-auto md:w-[420px] md:shrink-0">
            <PluginPanel p={sel} folders={folders} onClose={() => setSelected(null)} onChanged={() => load(true)} />
          </div>
        )}
      </div>
    </main>
  );
}
