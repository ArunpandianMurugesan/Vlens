"use client";

import { Loader2, ShieldQuestion } from "lucide-react";
import { useState } from "react";
import { answerPermission, type PermissionAsk } from "@/hooks/useTreeChat";
import { toolSummary } from "./MessageBubble";

// Claude is waiting for your OK to run a tool, like the prompt in the terminal.
export function PermissionCard({ ask }: { ask: PermissionAsk }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const answer = async (d: "allow" | "always" | "deny") => {
    setBusy(d);
    setErr(null);
    try {
      await answerPermission(ask.id, d); // the card goes away when the run confirms
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };
  const command = toolSummary(ask.tool, ask.input);
  const btn = "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50";

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3" data-no-select>
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
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button className={`${btn} bg-accent text-white`} disabled={!!busy} onClick={() => answer("allow")}>
          {busy === "allow" && <Loader2 size={12} className="animate-spin" />} Allow once
        </button>
        {ask.canRemember && (
          <button
            className={`${btn} border border-line bg-panel hover:border-accent hover:text-accent`}
            disabled={!!busy}
            onClick={() => answer("always")}
            title="Saves an allow rule for this command in the project's .claude/settings.local.json, like choosing “always” in the terminal"
          >
            {busy === "always" && <Loader2 size={12} className="animate-spin" />} Always allow in this project
          </button>
        )}
        <button className={`${btn} text-muted hover:text-ink`} disabled={!!busy} onClick={() => answer("deny")}>
          {busy === "deny" && <Loader2 size={12} className="animate-spin" />} Deny
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
    </div>
  );
}
