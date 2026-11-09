"use client";

import { Loader2, ShieldCheck, ShieldQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { answerPermission, type PermissionAsk } from "@/hooks/useTreeChat";
import type { ChangeInfo } from "@/lib/botAbilities";
import { useMenu } from "@/lib/menu";
import type { PermissionMode } from "@/lib/modes";
import { toolSummary } from "./MessageBubble";
import { PlanCard } from "./PlanCard";
import { QuestionCard } from "./QuestionCard";

// Claude is waiting for your OK to run a tool, like the prompt in the terminal.
export function PermissionCard({ ask, onMode }: { ask: PermissionAsk; onMode?: (m: PermissionMode) => void }) {
  if (ask.plan !== undefined) return <PlanCard ask={ask} onMode={onMode} />;
  if (ask.questions) return <QuestionCard ask={ask} />;
  // A bot proposing a change to its own setup: a change card, not a tool prompt.
  const change = (ask.input as { change?: ChangeInfo } | null)?.change;
  if (change) return <ChangeCard ask={ask} change={change} />;
  return <ToolPermission ask={ask} />;
}

// Generic reasons the CLI gives for every prompt; only show ones that say something.
const PLAIN_REASON = /^this command requires approval\.?$/i;

// Same choices as the terminal prompt: Yes / Yes, and don't ask again… / No, and tell Claude what to do differently.
// Keys 1–3 pick them, Esc says no, like the terminal.
function ToolPermission({ ask }: { ask: PermissionAsk }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [telling, setTelling] = useState(false);
  const [note, setNote] = useState("");
  const answer = async (d: "allow" | "always" | "deny", message?: string) => {
    setBusy(d);
    setErr(null);
    try {
      await answerPermission(ask.id, d, message); // the card goes away when the run confirms
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };
  const cardRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef(answer);
  answerRef.current = answer;

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("[data-perm-card]") !== cardRef.current) return; // only the oldest open prompt listens
      if (e.key === "1") answerRef.current("allow");
      else if (e.key === "2" && ask.always) answerRef.current("always");
      else if (e.key === (ask.always ? "3" : "2")) setTelling(true);
      else if (e.key === "Escape") answerRef.current("deny");
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [ask.always]);

  // The Mac menu's Allow / Always Allow / Deny: the oldest open prompt answers.
  useMenu({
    allow: () => document.querySelector("[data-perm-card]") === cardRef.current && answerRef.current("allow"),
    always: () => document.querySelector("[data-perm-card]") === cardRef.current && ask.always && answerRef.current("always"),
    deny: () => document.querySelector("[data-perm-card]") === cardRef.current && answerRef.current("deny"),
  });

  const command = ask.preview ?? toolSummary(ask.tool, ask.input);
  const reason = ask.reason && !PLAIN_REASON.test(ask.reason.trim()) ? ask.reason : null;
  const opt = "flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs disabled:opacity-50";
  const num = (n: number) => <span className="w-3 shrink-0 text-center font-mono text-[0.7rem] text-muted">{n}</span>;

  return (
    <div ref={cardRef} className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3" data-no-select data-perm-card>
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <ShieldQuestion size={15} className="text-amber-600" />
        Claude wants to use {ask.tool}
      </div>
      {ask.description && <p className="mt-1 text-xs text-muted">{ask.description}</p>}
      {command && (
        <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-term px-3 py-2 font-mono text-xs text-term-ink scroll-thin">
          {command}
        </pre>
      )}
      {reason && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{reason}</p>}
      <div className="mt-2.5 space-y-1.5">
        <button className={`${opt} border-accent bg-accent text-white`} disabled={!!busy} onClick={() => answer("allow")}>
          <span className="w-3 shrink-0 text-center font-mono text-[0.7rem] opacity-80">1</span>
          Yes
          {busy === "allow" && <Loader2 size={12} className="animate-spin" />}
        </button>
        {ask.always && (
          <button
            className={`${opt} border-line bg-panel hover:border-accent hover:text-accent`}
            disabled={!!busy}
            onClick={() => answer("always")}
            title="Saves the rule in the project's .claude/settings.local.json (or as shown), like choosing it in the terminal"
          >
            {num(2)}
            <span className="min-w-0 break-words">Yes, {ask.always[0].toLowerCase() + ask.always.slice(1)}</span>
            {busy === "always" && <Loader2 size={12} className="animate-spin" />}
          </button>
        )}
        {telling ? (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void answer("deny", note);
            }}
          >
            <input
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setTelling(false)}
              placeholder="Tell Claude what to do instead"
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs outline-none focus:border-accent"
            />
            <button className="rounded-lg border border-line bg-panel px-3 text-xs hover:border-accent hover:text-accent disabled:opacity-50" disabled={!!busy}>
              {busy === "deny" ? <Loader2 size={12} className="animate-spin" /> : "Send"}
            </button>
          </form>
        ) : (
          <button className={`${opt} border-line bg-panel/60 text-muted hover:text-ink`} disabled={!!busy} onClick={() => setTelling(true)}>
            {num(ask.always ? 3 : 2)}
            No, and tell Claude what to do differently
            <span className="ml-auto text-[0.68rem] opacity-70">(esc to just stop)</span>
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}

// A bot's setup change (lib/botAgent.ts): before → after in plain words, whether it
// gives it more access, and the rule underneath if you want to see it. Approve or No.
function ChangeCard({ ask, change }: { ask: PermissionAsk; change: ChangeInfo }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [rules, setRules] = useState(false);
  const [telling, setTelling] = useState(false);
  const [note, setNote] = useState("");
  const answer = async (d: "allow" | "deny", message?: string) => {
    setBusy(d);
    setErr(null);
    try {
      await answerPermission(ask.id, d, message);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };
  const pill = (t: string, tone: string) => <span className={`rounded-md px-1.5 py-0.5 text-xs ${tone}`}>{t}</span>;
  const tone = (t?: string) =>
    t === "On its own" ? "bg-green-500/15 text-green-700 dark:text-green-400" : t === "Never" ? "bg-red-500/15 text-red-700 dark:text-red-400" : "bg-sunken text-ink";
  const hasDiff = change.before !== undefined || change.after !== undefined;
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-panel" data-no-select data-perm-card>
      <div className="flex items-center gap-2 border-b border-line bg-sunken/60 px-3.5 py-2">
        <ShieldCheck size={14} className="shrink-0" />
        <span className="flex-1 text-sm font-semibold">{change.title ?? ask.tool}</span>
        {change.widens && <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[0.7rem] text-amber-700 dark:text-amber-400">Gives it more access</span>}
      </div>
      {change.items?.length ? (
        <div className="space-y-1 px-3.5 py-2.5">
          {change.items.map((it, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
              <span className="flex-1">{it.text}</span>
              {it.widens && <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[0.65rem] text-amber-700 dark:text-amber-400">More access</span>}
            </div>
          ))}
          {change.why && <p className="pt-1 text-xs text-muted">{change.why}</p>}
        </div>
      ) : hasDiff ? (
        <div className="grid grid-cols-2">
          <div className="space-y-1 border-r border-line px-3.5 py-2.5">
            <div className="text-[0.7rem] font-semibold text-muted">Before</div>
            <div className="text-sm">
              {change.what && <>{change.what}: </>}
              {pill(change.before || "—", tone(change.before))}
            </div>
          </div>
          <div className="space-y-1 bg-sunken/30 px-3.5 py-2.5">
            <div className="text-[0.7rem] font-semibold text-muted">After</div>
            <div className="text-sm">
              {change.what && <>{change.what}: </>}
              {pill(change.after || "—", tone(change.after))}
            </div>
            {change.why && <p className="text-xs text-muted">{change.why}</p>}
          </div>
        </div>
      ) : (
        ask.preview && <pre className="max-h-48 overflow-auto whitespace-pre-wrap px-3.5 py-2.5 font-sans text-sm scroll-thin">{ask.preview}</pre>
      )}
      {rules && change.rules?.length ? (
        <pre className="border-t border-line bg-term px-3.5 py-2 font-mono text-[0.7rem] text-term-ink">{change.rules.join("\n")}</pre>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3.5 py-2.5">
        <button onClick={() => void answer("allow")} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-1 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {busy === "allow" && <Loader2 size={12} className="animate-spin" />} Approve
        </button>
        <button onClick={() => void answer("deny")} disabled={!!busy} className="rounded-lg border border-line px-3.5 py-1 text-xs hover:border-accent hover:text-accent">
          {busy === "deny" ? <Loader2 size={12} className="animate-spin" /> : "No"}
        </button>
        {telling ? (
          <form
            className="flex min-w-0 flex-1 gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void answer("deny", note);
            }}
          >
            <input
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setTelling(false)}
              placeholder="What should it do instead?"
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2.5 py-1 text-xs outline-none focus:border-accent"
            />
            <button className="rounded-lg border border-line px-3 text-xs hover:border-accent hover:text-accent" disabled={!!busy}>
              Send
            </button>
          </form>
        ) : (
          <button onClick={() => setTelling(true)} disabled={!!busy} className="text-xs text-muted hover:text-ink">
            No, do this instead…
          </button>
        )}
        <span className="flex-1" />
        {!!change.rules?.length && (
          <button onClick={() => setRules((v) => !v)} className="text-xs text-muted hover:text-ink">
            {rules ? "Hide the rule" : "Show the rule"}
          </button>
        )}
      </div>
      {err && <p className="px-3.5 pb-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}
