"use client";

import { ArrowRight, Check, Copy, GitBranch, Loader2, LogIn, MessagesSquare, RefreshCw, SquareTerminal, Terminal } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import type { SetupStatus } from "@/lib/types";

// Vlens needs these on the Mac it runs on; Get started shows what's missing.
export const needsSetup = (s: SetupStatus) => !s.onboarded || !s.claude.installed || !s.account.loggedIn;

const INSTALL_CLAUDE = "curl -fsSL https://claude.ai/install.sh | bash";

function CopyCmd({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg bg-term px-3 py-1.5 font-mono text-xs text-term-ink">
      <span className="min-w-0 flex-1 truncate">{cmd}</span>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(cmd);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="shrink-0 opacity-70 hover:opacity-100"
        aria-label="Copy command"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

function Step({ n, done, title, optional, children }: { n: number; done: boolean; title: string; optional?: boolean; children: ReactNode }) {
  return (
    <li className="flex gap-3 rounded-xl border border-line bg-panel p-4">
      <span
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${done ? "bg-emerald-500 text-white" : "bg-sunken text-muted"}`}
      >
        {done ? <Check size={13} /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          {title}
          {optional && <span className="rounded bg-sunken px-1.5 py-0.5 text-[0.65rem] font-normal text-muted">optional</span>}
        </div>
        <div className="mt-1 text-xs text-muted">{children}</div>
      </div>
    </li>
  );
}

// First launch (or signed out): install Claude Code, sign in, and optionally set up
// the GitHub CLI for Vlens Review. Steps run in a terminal window; this page checks
// again every few seconds, so it ticks off as you go.
export function GetStarted({ initial, onDone }: { initial: SetupStatus; onDone: () => void }) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const res = await fetch("/api/setup").catch(() => null);
    if (res?.ok) setS(await res.json());
    setChecking(false);
  }, []);
  useEffect(() => {
    const t = setInterval(check, 4000);
    return () => clearInterval(t);
  }, [check]);

  const step = async (action: string) => {
    setBusy(action);
    setErr(null);
    const res = await fetch("/api/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    if (!res.ok) setErr((await res.json().catch(() => null))?.error ?? "Couldn't open a terminal window.");
    setTimeout(() => setBusy(null), 1500);
  };
  const finish = async () => {
    setBusy("finish");
    await fetch("/api/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ onboarded: true }) });
    onDone();
  };

  const ready = s.claude.installed && s.account.loggedIn;
  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50";
  const primary = `${btn} mt-2 bg-accent text-white`;
  const secondary = `${btn} mt-2 border border-line bg-panel text-ink hover:border-accent hover:text-accent`;
  const spin = (a: string) => busy === a && <Loader2 size={12} className="animate-spin" />;

  return (
    <div className="fixed inset-0 z-[150] overflow-y-auto bg-bg">
      <div className="mx-auto flex min-h-full max-w-xl flex-col justify-center px-6 py-12">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white">
            <MessagesSquare size={20} />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Welcome to Vlens</h1>
            <p className="text-sm text-muted">A window onto your Claude Code sessions. A few things to set up first.</p>
          </div>
        </div>

        <ol className="space-y-3">
          <Step n={1} done={s.claude.installed} title="Install Claude Code">
            {s.claude.installed ? (
              <>Installed (version {s.claude.version}).</>
            ) : (
              <>
                Vlens runs the <code>claude</code> command, and it isn&apos;t on this Mac yet. Install it in Terminal:
                <CopyCmd cmd={INSTALL_CLAUDE} />
                <button className={primary} disabled={!!busy} onClick={() => step("install-claude")}>
                  <SquareTerminal size={12} /> Install in Terminal {spin("install-claude")}
                </button>
              </>
            )}
          </Step>

          <Step n={2} done={s.account.loggedIn} title="Sign in to Claude">
            {s.account.loggedIn ? (
              <>
                Signed in as <span className="text-ink">{s.account.email ?? "your account"}</span>
                {s.account.plan && <> ({s.account.plan})</>}
                {s.account.orgName && <>, {s.account.orgName}</>}.
              </>
            ) : (
              <>
                Signs in with your Claude account in the browser, the same as <code>claude auth login</code>. Vlens uses the same account as your terminal.
                <div>
                  <button className={primary} disabled={!!busy || !s.claude.installed} onClick={() => step("login-claude")}>
                    <LogIn size={12} /> Sign in {spin("login-claude")}
                  </button>
                  {!s.claude.installed && <span className="ml-2">Install Claude Code first.</span>}
                </div>
              </>
            )}
          </Step>

          <Step n={3} done={!!s.gh.user} title="Connect GitHub" optional>
            {s.gh.user ? (
              <>
                Signed in to GitHub as <span className="text-ink">{s.gh.user}</span>. Vlens Review shows your PRs.
              </>
            ) : !s.gh.installed ? (
              <>
                Vlens Review reads your pull requests with the GitHub CLI. Install it with Homebrew (from{" "}
                <a href="https://brew.sh" target="_blank" rel="noreferrer" className="text-accent hover:underline">brew.sh</a>):
                <CopyCmd cmd="brew install gh" />
                <button className={secondary} disabled={!!busy} onClick={() => step("install-gh")}>
                  <Terminal size={12} /> Install in Terminal {spin("install-gh")}
                </button>
              </>
            ) : (
              <>
                The GitHub CLI is installed but not signed in.
                <div>
                  <button className={secondary} disabled={!!busy} onClick={() => step("login-gh")}>
                    <GitBranch size={12} /> Sign in to GitHub {spin("login-gh")}
                  </button>
                </div>
              </>
            )}
          </Step>
        </ol>

        {err && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600">{err}</p>}
        <p className="mt-3 text-xs text-muted">
          The first time Vlens opens Terminal, macOS asks whether it may control it. Click OK.
        </p>

        <div className="mt-6 flex items-center gap-3">
          <button className={`${btn} bg-accent px-4 py-2 text-sm text-white`} disabled={!ready || busy === "finish"} onClick={finish}>
            {ready ? "Get started" : "Finish steps 1 and 2"} {busy === "finish" ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}
          </button>
          <button onClick={check} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
            <RefreshCw size={12} className={checking ? "animate-spin" : ""} /> Check again
          </button>
        </div>
      </div>
    </div>
  );
}
