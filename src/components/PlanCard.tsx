"use client";

import { ChevronRight, ClipboardList, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { answerPermission, approvePlan, type PermissionAsk } from "@/hooks/useTreeChat";
import type { PermissionMode } from "@/lib/modes";
import { Markdown } from "./Markdown";

// The terminal's choices when Claude finishes planning.
const PROCEED: { mode: PermissionMode; label: string }[] = [
  { mode: "auto", label: "Yes, and use auto mode" },
  { mode: "acceptEdits", label: "Yes, and auto-accept edits" },
  { mode: "default", label: "Yes, and manually approve edits" },
];

// Claude is done planning (ExitPlanMode) and wants to start. Like the terminal:
// read the plan, then go ahead in a mode, or tell Claude what to change.
// Keys 1–4 pick, Esc stops.
export function PlanCard({ ask, onMode }: { ask: PermissionAsk; onMode?: (m: PermissionMode) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [telling, setTelling] = useState(false);
  const [note, setNote] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setErr(null);
    try {
      await fn(); // the card goes away when the run confirms
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };
  const proceed = (m: PermissionMode) =>
    run(m, async () => {
      await approvePlan(ask.id, m);
      onMode?.(m); // your next messages use this mode too
    });
  const keepPlanning = (message?: string) => run("deny", () => answerPermission(ask.id, "deny", message));

  const actions = useRef({ proceed, keepPlanning });
  actions.current = { proceed, keepPlanning };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("input, textarea, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("[data-perm-card]") !== cardRef.current) return; // only the oldest open prompt listens
      const n = Number(e.key);
      if (n >= 1 && n <= PROCEED.length) void actions.current.proceed(PROCEED[n - 1].mode);
      else if (n === PROCEED.length + 1) setTelling(true);
      else if (e.key === "Escape") void actions.current.keepPlanning();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const opt = "flex w-full items-center gap-2 rounded-lg border px-3 py-1.5 text-left text-xs disabled:opacity-50";
  const num = (n: number, light?: boolean) => <span className={`w-3 shrink-0 text-center font-mono text-[0.7rem] ${light ? "opacity-80" : "text-muted"}`}>{n}</span>;

  return (
    <div ref={cardRef} className="rounded-xl border border-accent/40 bg-accent-soft/30 p-3" data-no-select data-perm-card>
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <ClipboardList size={15} className="text-accent" />
        Claude&apos;s plan is ready. Go ahead?
      </div>
      <div className="mt-2 max-h-[28rem] overflow-auto rounded-lg border border-line bg-panel px-4 py-3 scroll-thin" data-plan>
        <Markdown text={ask.plan ?? ""} />
      </div>
      <div className="mt-2.5 space-y-1.5">
        {PROCEED.map((p, i) => (
          <button
            key={p.mode}
            className={`${opt} ${i === 0 ? "border-accent bg-accent text-white" : "border-line bg-panel hover:border-accent hover:text-accent"}`}
            disabled={!!busy}
            onClick={() => proceed(p.mode)}
          >
            {num(i + 1, i === 0)}
            {p.label}
            {busy === p.mode && <Loader2 size={12} className="animate-spin" />}
          </button>
        ))}
        {telling ? (
          <form
            className="flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              void keepPlanning(note);
            }}
          >
            <input
              autoFocus
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setTelling(false)}
              placeholder="What should Claude change in the plan?"
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs outline-none focus:border-accent"
            />
            <button className="rounded-lg border border-line bg-panel px-3 text-xs hover:border-accent hover:text-accent disabled:opacity-50" disabled={!!busy}>
              {busy === "deny" ? <Loader2 size={12} className="animate-spin" /> : "Send"}
            </button>
          </form>
        ) : (
          <button className={`${opt} border-line bg-panel/60 text-muted hover:text-ink`} disabled={!!busy} onClick={() => setTelling(true)}>
            {num(PROCEED.length + 1)}
            No, keep planning
            <span className="ml-auto text-[0.68rem] opacity-70">(esc to just stop)</span>
          </button>
        )}
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}

// A plan Claude presented earlier in the session (ExitPlanMode): folded, with whether you went ahead.
export function PlanRecord({ input, result }: { input: unknown; result?: { text: string; isError: boolean } }) {
  const [open, setOpen] = useState(false);
  const plan = String((input as { plan?: string } | null)?.plan ?? "");
  const status = !result ? "Waiting for your OK…" : result.isError ? "Plan not approved" : "Plan approved";
  return (
    <div className="rounded-lg border border-line bg-sunken/60 text-[0.8rem]" data-no-select>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-muted hover:text-ink">
        <ChevronRight size={13} className={`shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
        <ClipboardList size={13} className={`shrink-0 ${result ? "" : "animate-pulse text-accent"}`} />
        <span className="font-medium text-ink">Plan</span>
        <span className="truncate">{status}</span>
      </button>
      {open && plan && (
        <div className="border-t border-line px-4 py-3">
          <Markdown text={plan} />
        </div>
      )}
    </div>
  );
}
