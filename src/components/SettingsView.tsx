"use client";

import {
  ArrowLeft,
  ChevronRight,
  Cpu,
  ExternalLink,
  FileText,
  Network,
  Webhook,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  User,
  Wand2,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { TreeChat } from "@/hooks/useTreeChat";
import { MODELS } from "@/lib/models";
import type { Account, HookEntry, McpServer, Settings, Skill } from "@/lib/types";
import { MermaidBlock } from "./Mermaid";

async function post<T = unknown>(url: string, body: object): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => null);
  if (!res.ok) throw new Error(d?.error ?? res.statusText);
  return d;
}

function Section({ icon: Icon, title, hint, children, action }: { icon: typeof User; title: string; hint?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-panel p-5">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Icon size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-medium">{title}</h2>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const btn = "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";
const select = "rounded-lg border border-line bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent";

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line py-3 first:border-t-0 first:pt-0">
      <div className="min-w-48 flex-1">
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 rounded-full transition ${on ? "bg-accent" : "bg-line"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}

function Err({ msg }: { msg: string | null }) {
  return msg ? <p className="mt-2 whitespace-pre-wrap rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{msg}</p> : null;
}

// ── Account ────────────────────────────────────────────────────────────────

function AccountSection() {
  const [acct, setAcct] = useState<Account | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => fetch("/api/account").then((r) => r.json()).then(setAcct), []);
  useEffect(() => void load(), [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Section icon={User} title="Account" hint="The Claude account the CLI (and Lens) uses." action={<button className={btn} onClick={() => load()}><RefreshCw size={12} /></button>}>
      {!acct ? (
        <Loader2 size={16} className="animate-spin text-muted" />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <span className="text-muted">Status</span>
            <span>{acct.loggedIn ? "Signed in" : "Signed out"}</span>
            {acct.email && (
              <>
                <span className="text-muted">Email</span>
                <span className="truncate">{acct.email}</span>
              </>
            )}
            {acct.orgName && (
              <>
                <span className="text-muted">Organization</span>
                <span className="truncate">{acct.orgName}</span>
              </>
            )}
            {acct.plan && (
              <>
                <span className="text-muted">Plan</span>
                <span className="capitalize">{acct.plan}</span>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className={btn}
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await post("/api/account", { action: "login" });
                  setNote("Finish signing in in the terminal window that just opened, then click refresh.");
                })
              }
            >
              <LogIn size={12} /> {acct.loggedIn ? "Switch account" : "Sign in"}
            </button>
            {acct.loggedIn &&
              (confirmOut ? (
                <span className="flex items-center gap-2 text-xs">
                  Sign out of Claude Code on this Mac?
                  <button className={`${btn} border-red-500/40 text-red-600`} disabled={busy} onClick={() => run(async () => { setAcct(await post<Account>("/api/account", { action: "logout" })); setConfirmOut(false); })}>
                    Sign out
                  </button>
                  <button className={btn} onClick={() => setConfirmOut(false)}>Cancel</button>
                </span>
              ) : (
                <button className={btn} onClick={() => setConfirmOut(true)}>
                  <LogOut size={12} /> Sign out
                </button>
              ))}
          </div>
          {note && <p className="mt-2 text-xs text-muted">{note}</p>}
          <Err msg={err} />
        </>
      )}
    </Section>
  );
}

// ── Model ──────────────────────────────────────────────────────────────────

function ModelSection({ settings, save }: { settings: Settings; save: (p: Partial<Settings>) => void }) {
  return (
    <Section icon={Cpu} title="Model" hint="Used for replies, new sessions and sub-agents started from Lens. Your terminal claude is not changed.">
      <Row label="Default model" hint="You can still switch per message, next to the message box.">
        <select className={select} value={settings.defaultModel} onChange={(e) => save({ defaultModel: e.target.value })}>
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </Row>
      <Row label="Sub-agent model" hint="Sub-agents run read-only, and in read-only mode the CLI uses at least Sonnet, so Haiku becomes Sonnet there.">
        <select className={select} value={settings.subAgentModel} onChange={(e) => save({ subAgentModel: e.target.value })}>
          <option value="">Same as default</option>
          {MODELS.filter((m) => m.id).map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </Row>
    </Section>
  );
}

// ── Flow diagrams ──────────────────────────────────────────────────────────

const SAMPLE = `flowchart LR
  U["You"] e1@--> L["Claude Lens"]
  L e2@--> C["claude -p"]
  C --> T["Tools"]
  C e3@--> R["Reply"]
  e1@{ animate: true }
  e2@{ animate: true }
  e3@{ animate: true }`;

function DiagramsSection({ settings, save }: { settings: Settings; save: (p: Partial<Settings>) => void }) {
  return (
    <Section icon={Network} title="Flow diagrams" hint="Built into Lens. Mermaid diagrams in replies are drawn as real, animated diagrams.">
      <Row label="Draw diagrams" hint="Show Mermaid code blocks as diagrams. Off: show them as code.">
        <Toggle label="Draw diagrams" on={settings.showDiagrams} onChange={(v) => save({ showDiagrams: v })} />
      </Row>
      <Row label="Animate every arrow" hint="Off: only arrows the diagram marks as animated move.">
        <Toggle label="Animate every arrow" on={settings.animateDiagrams} onChange={(v) => save({ animateDiagrams: v })} />
      </Row>
      <Row
        label="Diagrams skill (lens:diagrams)"
        hint="Tells Claude to draw a diagram when a flow, architecture or sequence explains things better. Loaded only into sessions Lens runs; your terminal claude doesn't get it."
      >
        <Toggle label="Diagrams skill" on={settings.diagramSkill} onChange={(v) => save({ diagramSkill: v })} />
      </Row>
      {settings.showDiagrams && (
        <div className="border-t border-line pt-3">
          <div className="mb-2 text-xs text-muted">Preview</div>
          <MermaidBlock code={SAMPLE} />
        </div>
      )}
    </Section>
  );
}

// ── Auto-restore ───────────────────────────────────────────────────────────

function RestoreSection({ chat, settings, save }: { chat: TreeChat; settings: Settings; save: (p: Partial<Settings>) => void }) {
  const [err, setErr] = useState<string | null>(null);
  const act = (key: string, action: "restore" | "dismiss") =>
    chat.handleCrashed(key, action).then(() => setErr(null), (e: Error) => setErr(e.message));

  return (
    <Section icon={RotateCcw} title="Auto-restore" hint="Brings back terminal sessions that stopped unexpectedly: a crash, a closed window, or a reboot.">
      <Row label="Reopen automatically" hint="Off: Lens shows them in the sidebar and you choose. On: Lens reopens them as soon as it notices (while Lens is running).">
        <Toggle label="Reopen automatically" on={settings.autoRestore} onChange={(v) => save({ autoRestore: v })} />
      </Row>
      <Row label="Open in" hint="Restored sessions and sign-in flows open a new window here.">
        <select className={select} value={settings.terminalApp} onChange={(e) => save({ terminalApp: e.target.value as Settings["terminalApp"] })}>
          <option value="Terminal">Terminal</option>
          <option value="iTerm">iTerm</option>
        </select>
      </Row>
      <div className="border-t border-line pt-3">
        <div className="mb-2 text-sm">Stopped unexpectedly</div>
        {chat.crashed.length === 0 ? (
          <p className="text-xs text-muted">Nothing to restore.</p>
        ) : (
          <ul className="space-y-1.5">
            {chat.crashed.map((c) => (
              <li key={c.key} className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="truncate">{c.title}</div>
                  <div className="truncate text-xs text-muted">{c.cwd}</div>
                </div>
                <button className={btn} onClick={() => act(c.key, "restore")}>Restore</button>
                <button className={btn} onClick={() => act(c.key, "dismiss")}>Dismiss</button>
              </li>
            ))}
          </ul>
        )}
        <Err msg={err} />
      </div>
    </Section>
  );
}

// ── MCP servers & connectors ───────────────────────────────────────────────

const STATUS: Record<McpServer["status"], string> = {
  connected: "bg-emerald-500",
  "needs-auth": "bg-amber-500",
  pending: "bg-line",
  failed: "bg-red-500",
};

function McpRow({ s, busy, onAction }: { s: McpServer; busy: boolean; onAction: (a: "remove" | "login" | "logout") => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-2 border-t border-line py-2 first:border-t-0">
      <span title={s.statusText} className={`h-2 w-2 shrink-0 rounded-full ${STATUS[s.status]}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm">
          {s.kind === "connector" ? s.name.replace(/^claude\.ai /, "") : s.name}
          {s.scope && <span className="ml-2 rounded bg-sunken px-1.5 text-[0.65rem] text-muted">{s.scope === "user" ? "all projects" : "one project"}</span>}
        </div>
        <div className="truncate font-mono text-[0.7rem] text-muted" title={s.project ?? s.target}>
          {s.transport} · {s.target}
        </div>
        {s.project && <div className="truncate text-[0.7rem] text-muted">in {s.project}</div>}
      </div>
      <span className="text-xs text-muted">{s.statusText.replace(/^[^A-Za-z]+/, "")}</span>
      {s.status === "needs-auth" ? (
        <button className={btn} disabled={busy} onClick={() => onAction("login")}>
          <KeyRound size={12} /> Sign in
        </button>
      ) : (
        s.transport !== "stdio" && s.status === "connected" && (
          <button className={btn} disabled={busy} onClick={() => onAction("logout")} title="Forget this server's saved sign-in">
            <LogOut size={12} />
          </button>
        )
      )}
      {s.kind === "server" &&
        (confirm ? (
          <>
            <button className={`${btn} border-red-500/40 text-red-600`} disabled={busy} onClick={() => onAction("remove")}>Remove</button>
            <button className={btn} onClick={() => setConfirm(false)}>Cancel</button>
          </>
        ) : (
          <button className={btn} onClick={() => setConfirm(true)} aria-label={`Remove ${s.name}`}>
            <Trash2 size={12} />
          </button>
        ))}
    </li>
  );
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

function AddMcpForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", transport: "http", target: "", args: "", env: "", headers: "", scope: "user", project: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const input = "w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent";
  const stdio = f.transport === "stdio";

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await post("/api/mcp", {
        action: "add",
        name: f.name.trim(),
        transport: f.transport,
        target: f.target.trim(),
        args: stdio ? f.args.split(/\s+/).filter(Boolean) : [],
        env: stdio ? lines(f.env) : [],
        headers: stdio ? [] : lines(f.headers),
        scope: f.scope,
        project: f.project,
      });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-line bg-sunken p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
        <input className={input} placeholder="Name, e.g. sentry" value={f.name} onChange={set("name")} />
        <select className={select} value={f.transport} onChange={set("transport")}>
          <option value="http">HTTP</option>
          <option value="sse">SSE</option>
          <option value="stdio">Local command (stdio)</option>
        </select>
      </div>
      <input className={`${input} font-mono`} placeholder={stdio ? "Command, e.g. npx" : "URL, e.g. https://mcp.sentry.dev/mcp"} value={f.target} onChange={set("target")} />
      {stdio ? (
        <>
          <input className={`${input} font-mono`} placeholder="Arguments, separated by spaces, e.g. -y my-mcp-server" value={f.args} onChange={set("args")} />
          <textarea className={`${input} font-mono`} rows={2} placeholder={"Environment, one per line: KEY=value"} value={f.env} onChange={set("env")} />
        </>
      ) : (
        <textarea className={`${input} font-mono`} rows={2} placeholder={"Headers (optional), one per line: Authorization: Bearer …"} value={f.headers} onChange={set("headers")} />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select className={select} value={f.scope} onChange={set("scope")}>
          <option value="user">All projects</option>
          <option value="local">One project folder</option>
        </select>
        {f.scope === "local" && <input className={`${input} min-w-48 flex-1 font-mono`} placeholder="~/Desktop/my-project" value={f.project} onChange={set("project")} />}
        <button className={`${btn} ml-auto border-accent bg-accent text-white hover:text-white`} disabled={busy} onClick={submit}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add server
        </button>
      </div>
      <Err msg={err} />
    </div>
  );
}

function Group({ title, count, defaultOpen, children }: { title: string; count: number; defaultOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-line first:border-t-0">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 py-2 text-left text-xs text-muted hover:text-ink">
        <ChevronRight size={13} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="font-medium">{title}</span>
        <span className="rounded-full bg-sunken px-1.5">{count}</span>
      </button>
      {open && <div className="pb-2 pl-5">{children}</div>}
    </div>
  );
}

function McpSection() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      setServers(await fetch(`/api/mcp${fresh ? "?fresh=1" : ""}`).then((r) => r.json()));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);

  const act = async (name: string, action: "remove" | "login" | "logout") => {
    setBusy(name);
    setErr(null);
    setNote(null);
    try {
      await post("/api/mcp", { action, name });
      if (action === "login") setNote(`Finish signing in to ${name} in the terminal window that just opened, then click refresh.`);
      else await load(true);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  };

  const own = servers?.filter((s) => s.kind === "server") ?? [];
  const [q, setQ] = useState("");
  const connectors = (servers?.filter((s) => s.kind === "connector") ?? []).filter(
    (s) => !q || s.name.toLowerCase().includes(q.toLowerCase()),
  );
  // Connected ones are open by default; the long "needs sign-in" list starts folded.
  const groups = [
    { id: "connected", title: "Connected", items: connectors.filter((s) => s.status === "connected"), open: true },
    { id: "needs-auth", title: "Needs sign-in", items: connectors.filter((s) => s.status === "needs-auth"), open: false },
    { id: "other", title: "Not working", items: connectors.filter((s) => s.status === "failed" || s.status === "pending"), open: true },
  ].filter((g) => g.items.length);

  return (
    <Section
      icon={Plug}
      title="MCP servers & connectors"
      hint="Tools Claude can use. Changes apply to new and resumed sessions."
      action={
        <button className={btn} onClick={() => load(true)} disabled={loading} aria-label="Refresh MCP list">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
        </button>
      }
    >
      {!servers ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          <Loader2 size={14} className="animate-spin" /> Checking servers (takes a few seconds)…
        </div>
      ) : (
        <>
          <div className="mb-1 flex items-center">
            <h3 className="text-sm font-medium">Your servers</h3>
            <button className={`${btn} ml-auto`} onClick={() => setAdding((a) => !a)}>
              <Plus size={12} /> Add
            </button>
          </div>
          {adding && (
            <AddMcpForm
              onDone={() => {
                setAdding(false);
                void load(true);
              }}
            />
          )}
          <ul className="mb-5">
            {own.map((s) => (
              <McpRow key={s.name} s={s} busy={busy === s.name} onAction={(a) => act(s.name, a)} />
            ))}
            {own.length === 0 && <li className="py-2 text-xs text-muted">None yet.</li>}
          </ul>

          <div className="mb-1 flex items-center">
            <h3 className="text-sm font-medium">claude.ai connectors</h3>
            <a
              href="https://claude.ai/settings/connectors"
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline"
            >
              Add or remove on claude.ai <ExternalLink size={11} />
            </a>
          </div>
          <label className="my-2 flex items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm">
            <Search size={13} className="text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Find a connector"
              className="w-full bg-transparent outline-none placeholder:text-muted"
            />
          </label>
          {groups.map((g) => (
            // While searching, open every group so matches are visible.
            <Group key={`${g.id}-${!!q}`} title={g.title} count={g.items.length} defaultOpen={g.open || !!q}>
              <ul>
                {g.items.map((s) => (
                  <McpRow key={s.name} s={s} busy={busy === s.name} onAction={(a) => act(s.name, a)} />
                ))}
              </ul>
            </Group>
          ))}
          {groups.length === 0 && <p className="py-2 text-xs text-muted">No connectors match.</p>}
          {note && <p className="mt-2 text-xs text-muted">{note}</p>}
          <Err msg={err} />
        </>
      )}
    </Section>
  );
}

// ── Skills ─────────────────────────────────────────────────────────────────

const SOURCE_LABEL: Record<Skill["source"], string> = {
  user: "Your skills",
  project: "This project's skills",
  synced: "Synced from claude.ai",
  plugin: "From plugins",
};

function SkillEditor({ skill, project, onClose, onSaved }: { skill: Skill; project: string; onClose: () => void; onSaved: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams({ path: skill.path, ...(project ? { project } : {}) });
    fetch(`/api/skills?${q}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setErr(d.error) : setContent(d.content)));
  }, [skill.path, project]);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await post("/api/skills", { action: "save", path: skill.path, content, project: project || undefined });
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="mt-2 rounded-xl border border-line bg-sunken p-2">
      <div className="mb-1.5 truncate px-1 font-mono text-[0.68rem] text-muted" title={skill.path}>
        {skill.path}/SKILL.md
      </div>
      {content === null ? (
        !err && <Loader2 size={14} className="m-2 animate-spin text-muted" />
      ) : skill.editable ? (
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          rows={14}
          className="w-full resize-y rounded-lg border border-line bg-bg p-2 font-mono text-xs leading-relaxed outline-none focus:border-accent"
        />
      ) : (
        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-bg p-2 font-mono text-xs leading-relaxed scroll-thin">{content}</pre>
      )}
      <div className="mt-2 flex justify-end gap-2">
        <button className={btn} onClick={onClose}>{skill.editable ? "Cancel" : "Close"}</button>
        {skill.editable && content !== null && (
          <button className={`${btn} border-accent bg-accent text-white hover:text-white`} disabled={busy} onClick={save}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : null} Save
          </button>
        )}
      </div>
      <Err msg={err} />
    </div>
  );
}

function SkillRow({ s, project, busy, onToggle, onDelete, onChanged }: { s: Skill; project: string; busy: boolean; onToggle: () => void; onDelete: () => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="border-t border-line py-2 first:border-t-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className={`text-sm ${s.enabled ? "" : "text-muted line-through decoration-1"}`}>{s.name}</div>
          <div className="line-clamp-2 text-xs text-muted" title={s.description}>{s.description || "No description"}</div>
        </div>
        <button className={btn} onClick={() => setOpen((o) => !o)} aria-label={`${s.editable ? "Edit" : "View"} ${s.name}`}>
          <FileText size={12} /> {s.editable ? "Edit" : "View"}
        </button>
        {s.editable && (
          <>
            {confirm ? (
              <>
                <button className={`${btn} border-red-500/40 text-red-600`} disabled={busy} onClick={onDelete}>Delete</button>
                <button className={btn} onClick={() => setConfirm(false)}>Cancel</button>
              </>
            ) : (
              <button className={btn} onClick={() => setConfirm(true)} aria-label={`Delete ${s.name}`} title="Moves it to the skills trash folder">
                <Trash2 size={12} />
              </button>
            )}
            <span className="pt-0.5">
              <Toggle label={`${s.enabled ? "Turn off" : "Turn on"} ${s.name}`} on={s.enabled} onChange={() => !busy && onToggle()} />
            </span>
          </>
        )}
      </div>
      {open && (
        <SkillEditor
          skill={s}
          project={project}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}

function NewSkillForm({ project, onDone }: { project: string; onDone: () => void }) {
  const [f, setF] = useState({ name: "", description: "", body: "", scope: "user" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const input = "w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent";
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await post("/api/skills", { action: "create", ...f, name: f.name.trim(), project: project || undefined });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-line bg-sunken p-3">
      <input className={`${input} font-mono`} placeholder="name, e.g. release-notes" value={f.name} onChange={set("name")} />
      <textarea className={input} rows={2} placeholder="When should Claude use it? e.g. Use when writing release notes from merged PRs." value={f.description} onChange={set("description")} />
      <textarea className={`${input} font-mono text-xs`} rows={6} placeholder={"Instructions (markdown). What to do, step by step."} value={f.body} onChange={set("body")} />
      <div className="flex flex-wrap items-center gap-2">
        <select className={select} value={f.scope} onChange={set("scope")}>
          <option value="user">For all projects</option>
          <option value="project" disabled={!project}>Only this project{project ? "" : " (pick one above)"}</option>
        </select>
        <button className={`${btn} ml-auto border-accent bg-accent text-white hover:text-white`} disabled={busy} onClick={submit}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Create skill
        </button>
      </div>
      <Err msg={err} />
    </div>
  );
}

function SkillsSection({ chat }: { chat: TreeChat }) {
  const [project, setProject] = useState("");
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const folders = [...new Set(chat.sessions.map((s) => s.cwd).filter((c): c is string => !!c))];

  const load = useCallback(async () => {
    setSkills(await fetch(`/api/skills${project ? `?project=${encodeURIComponent(project)}` : ""}`).then((r) => r.json()));
  }, [project]);
  useEffect(() => void load(), [load]);

  const act = async (s: Skill, body: object) => {
    setBusy(s.path);
    setErr(null);
    try {
      await post("/api/skills", { ...body, path: s.path, project: project || undefined });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  };

  const shown = (skills ?? []).filter((s) => !q || `${s.name} ${s.description}`.toLowerCase().includes(q.toLowerCase()));
  const groups = (["user", "project", "synced", "plugin"] as const)
    .map((src) => ({ src, items: shown.filter((s) => s.source === src) }))
    .filter((g) => g.items.length || g.src === "user");

  return (
    <Section
      icon={Wand2}
      title="Skills"
      hint="Instructions Claude loads when a task matches. Changes apply to new and resumed sessions."
      action={
        <button className={btn} onClick={() => setAdding((a) => !a)}>
          <Plus size={12} /> New
        </button>
      }
    >
      <div className="mb-2 flex flex-wrap gap-2">
        <select className={`${select} min-w-0 flex-1`} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Also show skills for a project">
          <option value="">No project selected</option>
          {folders.map((f) => (
            <option key={f} value={f}>Project: {f.split("/").filter(Boolean).pop()}</option>
          ))}
        </select>
        <label className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm">
          <Search size={13} className="text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a skill" className="w-full bg-transparent outline-none placeholder:text-muted" />
        </label>
      </div>
      {adding && (
        <NewSkillForm
          project={project}
          onDone={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
      {!skills ? (
        <Loader2 size={16} className="animate-spin text-muted" />
      ) : (
        groups.map((g) => (
          <Group key={`${g.src}-${!!q}`} title={SOURCE_LABEL[g.src]} count={g.items.length} defaultOpen={g.src === "user" || g.src === "project" || !!q}>
            <ul>
              {g.items.map((s) => (
                <SkillRow
                  key={s.path}
                  s={s}
                  project={project}
                  busy={busy === s.path}
                  onToggle={() => act(s, { action: "toggle", enabled: !s.enabled })}
                  onDelete={() => act(s, { action: "delete" })}
                  onChanged={load}
                />
              ))}
              {g.items.length === 0 && <li className="py-1 text-xs text-muted">None yet.</li>}
            </ul>
          </Group>
        ))
      )}
      <Err msg={err} />
    </Section>
  );
}

// ── Hooks ──────────────────────────────────────────────────────────────────

// Events you'll reach for most, shown first when adding a hook.
const COMMON_EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "Notification", "SessionStart", "SessionEnd", "SubagentStop", "PreCompact"];

const SCOPE_LABEL: Record<HookEntry["scope"], string> = {
  user: "all projects",
  project: "project, shared",
  local: "project, only you",
  plugin: "plugin",
};

const hookMain = (h: HookEntry["hook"]) => h.command ?? h.prompt ?? h.url ?? JSON.stringify(h);

function HookEditor({ entry, project, onClose, onSaved }: { entry: HookEntry; project: string; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState(JSON.stringify({ matcher: entry.matcher ?? "", ...entry.hook }, null, 2));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { matcher, ...hook } = JSON.parse(text);
      await post("/api/hooks", { action: "update", id: entry.id, project: project || undefined, matcher, hook });
      onSaved();
    } catch (e) {
      setErr(e instanceof SyntaxError ? `That isn't valid JSON: ${e.message}` : (e as Error).message);
    }
    setBusy(false);
  };
  const editable = entry.scope !== "plugin";
  return (
    <div className="mt-2 rounded-xl border border-line bg-sunken p-2">
      <div className="mb-1.5 truncate px-1 font-mono text-[0.68rem] text-muted" title={entry.file}>
        {entry.file}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        readOnly={!editable}
        spellCheck={false}
        rows={Math.min(14, text.split("\n").length + 1)}
        className="w-full resize-y rounded-lg border border-line bg-bg p-2 font-mono text-xs leading-relaxed outline-none focus:border-accent"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button className={btn} onClick={onClose}>{editable ? "Cancel" : "Close"}</button>
        {editable && (
          <button className={`${btn} border-accent bg-accent text-white hover:text-white`} disabled={busy} onClick={save}>
            {busy && <Loader2 size={12} className="animate-spin" />} Save
          </button>
        )}
      </div>
      <Err msg={err} />
    </div>
  );
}

function HookRow({ h, project, busy, onToggle, onRemove, onChanged }: { h: HookEntry; project: string; busy: boolean; onToggle: () => void; onRemove: () => void; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const editable = h.scope !== "plugin";
  return (
    <li className="border-t border-line py-2 first:border-t-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="rounded bg-sunken px-1.5 font-mono">{h.matcher || "any"}</span>
            <span className="text-muted">{h.hook.type}</span>
            <span className="rounded bg-sunken px-1.5 text-[0.65rem] text-muted">{h.plugin ? `plugin: ${h.plugin}` : SCOPE_LABEL[h.scope]}</span>
            {h.managedBy && <span className="rounded bg-amber-500/15 px-1.5 text-[0.65rem] text-amber-700 dark:text-amber-400">added by {h.managedBy}</span>}
          </div>
          <div className={`mt-1 line-clamp-2 break-all font-mono text-[0.72rem] ${h.enabled ? "" : "text-muted line-through decoration-1"}`} title={hookMain(h.hook)}>
            {hookMain(h.hook)}
          </div>
        </div>
        <button className={btn} onClick={() => setOpen((o) => !o)} aria-label={`${editable ? "Edit" : "View"} hook`}>
          <FileText size={12} /> {editable ? "Edit" : "View"}
        </button>
        {editable && (
          <>
            {confirm ? (
              <span className="flex items-center gap-1.5">
                {h.managedBy && <span className="text-[0.65rem] text-muted">{h.managedBy} may add it back</span>}
                <button className={`${btn} border-red-500/40 text-red-600`} disabled={busy} onClick={onRemove}>Delete</button>
                <button className={btn} onClick={() => setConfirm(false)}>Cancel</button>
              </span>
            ) : (
              <button className={btn} onClick={() => setConfirm(true)} aria-label="Delete hook">
                <Trash2 size={12} />
              </button>
            )}
            <span className="pt-0.5">
              <Toggle label={h.enabled ? "Turn hook off" : "Turn hook on"} on={h.enabled} onChange={() => !busy && onToggle()} />
            </span>
          </>
        )}
      </div>
      {open && (
        <HookEditor
          entry={h}
          project={project}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </li>
  );
}

function NewHookForm({ events, project, onDone }: { events: string[]; project: string; onDone: () => void }) {
  const [f, setF] = useState({ event: "PreToolUse", matcher: "", type: "command", main: "", timeout: "", scope: "user" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }));
  const input = "w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-sm outline-none focus:border-accent";
  const field = { command: "command", prompt: "prompt", agent: "prompt", http: "url" }[f.type]!;
  const ordered = [...COMMON_EVENTS.filter((e) => events.includes(e)), ...events.filter((e) => !COMMON_EVENTS.includes(e))];
  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const hook: Record<string, unknown> = { type: f.type, [field]: f.main.trim() };
      if (f.timeout.trim()) hook.timeout = Number(f.timeout);
      await post("/api/hooks", { action: "add", scope: f.scope, project: project || undefined, event: f.event, matcher: f.matcher, hook });
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-line bg-sunken p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <select className={select} value={f.event} onChange={set("event")} aria-label="Event">
          {ordered.map((e, i) => (
            <option key={e} value={e}>
              {i === COMMON_EVENTS.length ? "── " : ""}
              {e}
            </option>
          ))}
        </select>
        <input className={`${input} font-mono`} placeholder="Matcher (optional), e.g. Bash or Write|Edit" value={f.matcher} onChange={set("matcher")} />
      </div>
      <div className="grid gap-2 sm:grid-cols-[auto_1fr_6rem]">
        <select className={select} value={f.type} onChange={set("type")} aria-label="Hook type">
          <option value="command">Run a command</option>
          <option value="prompt">Ask Claude (prompt)</option>
          <option value="agent">Run an agent</option>
          <option value="http">Call a URL</option>
        </select>
        <input
          className={`${input} font-mono`}
          placeholder={field === "url" ? "https://…" : field === "prompt" ? "What to check, e.g. Did it run the tests?" : "Command, e.g. npx prettier --write \"$FILE\""}
          value={f.main}
          onChange={set("main")}
        />
        <input className={input} placeholder="Timeout s" inputMode="numeric" value={f.timeout} onChange={set("timeout")} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select className={select} value={f.scope} onChange={set("scope")} aria-label="Save to">
          <option value="user">All projects (~/.claude/settings.json)</option>
          <option value="project" disabled={!project}>This project, shared (.claude/settings.json)</option>
          <option value="local" disabled={!project}>This project, only you (.claude/settings.local.json)</option>
        </select>
        <button className={`${btn} ml-auto border-accent bg-accent text-white hover:text-white`} disabled={busy} onClick={submit}>
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add hook
        </button>
      </div>
      <p className="text-[0.7rem] text-muted">Hooks run on your Mac with your permissions. Only add commands you trust.</p>
      <Err msg={err} />
    </div>
  );
}

function HooksSection({ chat }: { chat: TreeChat }) {
  const [project, setProject] = useState("");
  const [data, setData] = useState<{ hooks: HookEntry[]; disableAll: boolean; events: string[] } | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmPause, setConfirmPause] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const folders = [...new Set(chat.sessions.map((s) => s.cwd).filter((c): c is string => !!c))];

  const load = useCallback(async () => {
    const d = await fetch(`/api/hooks${project ? `?project=${encodeURIComponent(project)}` : ""}`).then((r) => r.json());
    if (d.error) setErr(d.error);
    else setData(d);
  }, [project]);
  useEffect(() => void load(), [load]);

  const act = async (key: string, body: object) => {
    setBusy(key);
    setErr(null);
    try {
      await post("/api/hooks", { ...body, project: project || undefined });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  };

  // One folding group per event that has hooks, in the CLI's event order.
  const byEvent = (data?.events ?? []).map((e) => ({ event: e, items: (data?.hooks ?? []).filter((h) => h.event === e) })).filter((g) => g.items.length);

  return (
    <Section
      icon={Webhook}
      title="Hooks"
      hint="Commands that run automatically at points in a session, like before a tool runs or when Claude stops. Changes apply to new and resumed sessions."
      action={
        <button className={btn} onClick={() => setAdding((a) => !a)}>
          <Plus size={12} /> New
        </button>
      }
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select className={`${select} min-w-0 flex-1`} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Also show hooks for a project">
          <option value="">No project selected</option>
          {folders.map((f) => (
            <option key={f} value={f}>Project: {f.split("/").filter(Boolean).pop()}</option>
          ))}
        </select>
        {data && (
          <span className="flex items-center gap-2 text-xs text-muted">
            {confirmPause ? (
              <>
                {data.disableAll ? "Turn all hooks back on?" : "Pause every hook in every session?"}
                <button className={btn} onClick={() => act("all", { action: "disableAll", on: !data.disableAll }).then(() => setConfirmPause(false))}>
                  Yes
                </button>
                <button className={btn} onClick={() => setConfirmPause(false)}>Cancel</button>
              </>
            ) : (
              <>
                Pause all
                <Toggle label="Pause all hooks" on={data.disableAll} onChange={() => setConfirmPause(true)} />
              </>
            )}
          </span>
        )}
      </div>
      {data?.disableAll && (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          All hooks are paused (disableAllHooks is on). None of them run until you turn this off.
        </p>
      )}
      {adding && data && (
        <NewHookForm
          events={data.events}
          project={project}
          onDone={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
      {!data ? (
        !err && <Loader2 size={16} className="animate-spin text-muted" />
      ) : byEvent.length === 0 ? (
        <p className="py-2 text-xs text-muted">No hooks yet.</p>
      ) : (
        byEvent.map((g) => (
          <Group key={g.event} title={g.event} count={g.items.length} defaultOpen={false}>
            <ul>
              {g.items.map((h) => (
                <HookRow
                  key={h.id}
                  h={h}
                  project={project}
                  busy={busy === h.id}
                  onToggle={() => act(h.id, { action: "toggle", id: h.id, enabled: !h.enabled })}
                  onRemove={() => act(h.id, { action: "remove", id: h.id })}
                  onChanged={load}
                />
              ))}
            </ul>
          </Group>
        ))
      )}
      <Err msg={err} />
    </Section>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export function SettingsView({ chat, onBack }: { chat: TreeChat; onBack: () => void }) {
  const { settings, saveSettings } = chat;
  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button onClick={onBack} className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Back to chat">
          <ArrowLeft size={18} />
        </button>
        <h1 className="font-medium">Settings</h1>
      </header>
      <div className="flex-1 overflow-y-auto scroll-thin">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
          <AccountSection />
          {settings ? (
            <>
              <ModelSection settings={settings} save={saveSettings} />
              <DiagramsSection settings={settings} save={saveSettings} />
              <RestoreSection chat={chat} settings={settings} save={saveSettings} />
            </>
          ) : (
            <Loader2 size={16} className="animate-spin text-muted" />
          )}
          <SkillsSection chat={chat} />
          <HooksSection chat={chat} />
          <McpSection />
        </div>
      </div>
    </main>
  );
}
