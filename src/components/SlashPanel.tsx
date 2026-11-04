"use client";

import { Check, FileText, Loader2, Search, SquareTerminal, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type { TreeChat } from "@/hooks/useTreeChat";
import { MODELS } from "@/lib/models";
import { type Choice, configChoices, effortChoices, type SlashUi, styleChoices } from "@/lib/slash";
import type { McpServer } from "@/lib/types";
import { useFiles } from "./FileContext";

// The menu or screen for a slash command that opens one in the terminal (see
// lib/slash.ts). It sits above the message box, like the "/" list does.
interface Props {
  ui: SlashUi;
  chat: TreeChat;
  cwd: string | null;
  model: string; // the model picked for the next message ("" = default)
  mode: string;
  onModel: (m: string) => void;
  send: (text: string) => void; // sends a message, e.g. "/effort high"
  onSettings: (card: "mcp" | "hooks") => void;
  onTerminal: (cmd: string) => void; // run this command in the session's own terminal
  onClose: () => void;
}

const TITLES: Record<SlashUi, string> = {
  model: "Model",
  effort: "Effort",
  "output-style": "Output style",
  config: "Settings",
  resume: "Resume a session",
  memory: "Memory",
  status: "Status",
  mcp: "MCP servers",
  hooks: "Hooks",
  permissions: "Permissions",
};

export function SlashPanel(p: Props) {
  // Esc closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [p]);

  return (
    <div className="mb-2 rounded-xl border border-line bg-panel shadow-xl">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span className="font-mono text-xs text-accent">/{p.ui}</span>
        <span className="text-sm font-medium">{TITLES[p.ui]}</span>
        <button onClick={p.onClose} className="ml-auto rounded p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Close">
          <X size={14} />
        </button>
      </div>
      <div className="max-h-80 overflow-y-auto p-2 scroll-thin">
        <Body {...p} />
      </div>
    </div>
  );
}

function Body(p: Props) {
  switch (p.ui) {
    case "model":
      return (
        <Choices
          choices={MODELS.map((m) => ({ value: m.id, label: m.label, current: m.id === p.model }))}
          hint="Used from your next message on."
          onPick={(v) => {
            p.onModel(v);
            p.onClose();
          }}
        />
      );
    case "effort":
      return <FromCli {...p} parse={effortChoices} hint="How hard Claude thinks, for this session." />;
    case "output-style":
      return <FromCli {...p} parse={styleChoices} hint="How Claude writes its replies." />;
    case "config":
      return <ConfigMenu {...p} />;
    case "resume":
      return <ResumeMenu {...p} />;
    case "memory":
      return <MemoryMenu {...p} />;
    case "status":
      return <StatusView {...p} />;
    case "mcp":
      return <McpView {...p} />;
    case "hooks":
      return (
        <Note>
          Hooks run your own commands at points in Claude&apos;s work. Add, edit and switch them off in Settings.
          <Action onClick={() => p.onSettings("hooks")}>Open Hooks</Action>
        </Note>
      );
    case "permissions":
      return (
        <Note>
          The mode menu under the message box sets how much Claude asks first. For your allow and deny rules, open the CLI&apos;s own menu in this session&apos;s terminal.
          <Action icon onClick={() => p.onTerminal("/permissions")}>
            Open /permissions in the terminal
          </Action>
        </Note>
      );
  }
}

function Choices({ choices, hint, onPick }: { choices: Choice[]; hint?: string; onPick: (v: string) => void }) {
  return (
    <div className="space-y-0.5">
      {hint && <p className="px-2 pb-1 text-xs text-muted">{hint}</p>}
      {choices.map((c) => (
        <button
          key={c.value}
          onClick={() => onPick(c.value)}
          className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-sunken"
        >
          <Check size={14} className={`mt-0.5 shrink-0 ${c.current ? "text-accent" : "invisible"}`} />
          <span className="min-w-0">
            <span className="block text-sm">{c.label}</span>
            {c.hint && <span className="block text-xs text-muted">{c.hint}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

// The CLI's usage text for a command, fetched once per folder (api/slash).
function useCliText(cmd: string, cwd: string | null) {
  const [state, setState] = useState<{ text?: string; error?: string }>({});
  useEffect(() => {
    let stop = false;
    fetch(`/api/slash?cmd=${cmd}${cwd ? `&cwd=${encodeURIComponent(cwd)}` : ""}`)
      .then((r) => r.json())
      .then((d: { text?: string; error?: string }) => !stop && setState(d))
      .catch((e) => !stop && setState({ error: String(e) }));
    return () => {
      stop = true;
    };
  }, [cmd, cwd]);
  return state;
}

function Loading() {
  return (
    <div className="flex items-center gap-2 px-2 py-3 text-sm text-muted">
      <Loader2 size={14} className="animate-spin" /> Asking Claude what&apos;s available…
    </div>
  );
}

function FromCli(p: Props & { parse: (t: string) => Choice[]; hint: string }) {
  const { text, error } = useCliText(p.ui, p.cwd);
  if (error) return <Note>{error}</Note>;
  if (text === undefined) return <Loading />;
  const choices = p.parse(text);
  if (!choices.length) return <Note>{text}</Note>;
  return (
    <Choices
      choices={choices}
      hint={p.hint}
      onPick={(v) => {
        p.send(`/${p.ui} ${v}`);
        p.onClose();
      }}
    />
  );
}

function ConfigMenu(p: Props) {
  const { text, error } = useCliText("config", p.cwd);
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState<Record<string, string>>({});
  const rows = useMemo(() => (text ? configChoices(text) : []), [text]);
  if (error) return <Note>{error}</Note>;
  if (text === undefined) return <Loading />;
  const shown = rows.filter((r) => r.key.toLowerCase().includes(q.toLowerCase()));
  const set = (key: string, value: string) => {
    p.send(`/config ${key}=${value}`);
    p.onClose();
  };
  return (
    <div className="space-y-1">
      <label className="flex items-center gap-2 rounded-lg border border-line px-2 py-1">
        <Search size={13} className="text-muted" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a setting" className="w-full bg-transparent text-sm outline-none" />
      </label>
      {shown.map((r) => (
        <div key={r.key} className="flex flex-wrap items-center gap-1.5 rounded-lg px-2 py-1 hover:bg-sunken/60">
          <span className="mr-auto font-mono text-xs">{r.key}</span>
          {r.options ? (
            r.options.map((o) => (
              <button key={o} onClick={() => set(r.key, o)} className="rounded-md border border-line px-1.5 py-0.5 text-xs hover:border-accent hover:text-accent">
                {o}
              </button>
            ))
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (typed[r.key]?.trim()) set(r.key, typed[r.key].trim());
              }}
            >
              <input
                value={typed[r.key] ?? ""}
                onChange={(e) => setTyped((t) => ({ ...t, [r.key]: e.target.value }))}
                placeholder="value, then Enter"
                className="w-36 rounded-md border border-line bg-transparent px-1.5 py-0.5 text-xs outline-none focus:border-accent"
              />
            </form>
          )}
        </div>
      ))}
    </div>
  );
}

function ResumeMenu(p: Props) {
  const [everywhere, setEverywhere] = useState(false);
  const list = p.chat.sessions
    .filter((s) => s.id !== p.chat.activeId && (everywhere || !p.cwd || s.cwd === p.cwd))
    .slice(0, 30);
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-2 px-2 pb-1 text-xs text-muted">
        {everywhere ? "All folders" : "This folder"}
        <button onClick={() => setEverywhere((v) => !v)} className="ml-auto hover:text-accent">
          {everywhere ? "Only this folder" : "Show all folders"}
        </button>
      </div>
      {list.length === 0 && <p className="px-2 py-2 text-sm text-muted">No other sessions here.</p>}
      {list.map((s) => (
        <button
          key={s.id}
          onClick={() => {
            p.chat.selectSession(s.id);
            p.onClose();
          }}
          className="flex w-full items-baseline gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-sunken"
        >
          <span className="min-w-0 flex-1 truncate text-sm">{s.title}</span>
          {everywhere && <span className="shrink-0 text-xs text-muted">{s.projectName}</span>}
          <span className="shrink-0 text-xs text-muted">{ago(s.updatedAt)}</span>
        </button>
      ))}
    </div>
  );
}

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 60 ? `${Math.max(1, m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

// The CLAUDE.md files Claude reads for this folder, opened in the file panel.
function MemoryMenu(p: Props) {
  const files = useFiles();
  const candidates = useMemo(
    () => [
      ...(p.cwd ? [{ path: `${p.cwd}/CLAUDE.md`, label: "Project memory", hint: "CLAUDE.md, shared with your team" }] : []),
      ...(p.cwd ? [{ path: `${p.cwd}/CLAUDE.local.md`, label: "Your project notes", hint: "CLAUDE.local.md, just for you" }] : []),
      { path: "~/.claude/CLAUDE.md", label: "Your memory", hint: "~/.claude/CLAUDE.md, every project" },
    ],
    [p.cwd],
  );
  const [found, setFound] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    let stop = false;
    void Promise.all(candidates.map((c) => fetch(`/api/file?path=${encodeURIComponent(c.path)}`).then((r) => [c.path, r.ok] as const)))
      .then((r) => !stop && setFound(Object.fromEntries(r)))
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [candidates]);
  if (!found) return <Loading />;
  return (
    <div className="space-y-0.5">
      {candidates.map((c) => (
        <button
          key={c.path}
          disabled={!found[c.path]}
          onClick={() => {
            files?.open(c.path);
            p.onClose();
          }}
          className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-sunken disabled:opacity-50 disabled:hover:bg-transparent"
        >
          <FileText size={14} className="mt-0.5 shrink-0 text-muted" />
          <span className="min-w-0">
            <span className="block text-sm">{c.label}</span>
            <span className="block text-xs text-muted">{found[c.path] ? c.hint : `${c.hint} (not created yet)`}</span>
          </span>
        </button>
      ))}
      {p.cwd && !found[`${p.cwd}/CLAUDE.md`] && (
        <Action onClick={() => (p.send("/init"), p.onClose())}>Create one with /init</Action>
      )}
    </div>
  );
}

function StatusView(p: Props) {
  const s = p.chat.session;
  const [acct, setAcct] = useState<Record<string, string | null> | null>(null);
  useEffect(() => {
    fetch("/api/account")
      .then((r) => (r.ok ? r.json() : null))
      .then(setAcct)
      .catch(() => {});
  }, []);
  const ctx = s?.context;
  const rows: [string, ReactNode][] = [
    ["Session", s ? <span className="font-mono text-xs">{s.id}</span> : "New session"],
    ["Folder", p.cwd ?? "—"],
    ["Model", MODELS.find((m) => m.id === p.model)?.label ?? (p.model || "CLI default")],
    ["Mode", p.mode],
    ["Context", ctx ? `${Math.round(ctx.used / 1000)}k of ${Math.round(ctx.window / 1000)}k tokens${ctx.model ? ` · ${ctx.model}` : ""}` : "—"],
    ...(acct ? ([["Account", [acct.email, acct.orgName].filter(Boolean).join(" · ") || "—"]] as [string, ReactNode][]) : []),
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 px-2 py-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 break-all">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function McpView(p: Props) {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  useEffect(() => {
    fetch("/api/mcp")
      .then((r) => r.json())
      .then(setServers)
      .catch(() => setServers([]));
  }, []);
  if (!servers) return <Loading />;
  const dot = { connected: "bg-emerald-500", "needs-auth": "bg-amber-500", pending: "bg-sky-500", failed: "bg-red-500" };
  return (
    <div className="space-y-0.5">
      {servers.length === 0 && <p className="px-2 py-2 text-sm text-muted">No MCP servers yet.</p>}
      {servers.map((s) => (
        <div key={`${s.name}:${s.scope ?? ""}:${s.project ?? ""}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${dot[s.status]}`} />
          <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
          <span className="shrink-0 text-xs text-muted">{s.statusText}</span>
        </div>
      ))}
      <Action onClick={() => p.onSettings("mcp")}>Add or manage servers</Action>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <div className="space-y-2 whitespace-pre-wrap px-2 py-1 text-sm text-muted">{children}</div>;
}

function Action({ children, onClick, icon }: { children: ReactNode; onClick: () => void; icon?: boolean }) {
  return (
    <button onClick={onClick} className="mx-2 mt-1 flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent">
      {icon && <SquareTerminal size={12} />}
      {children}
    </button>
  );
}
