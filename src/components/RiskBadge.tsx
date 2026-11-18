"use client";

import { ShieldAlert } from "lucide-react";
import { type Risk, type RiskLevel, levelOf } from "@/lib/risk";

// The risk score as a small chip (lists, board) or a box with its reasons (a PR's rail).

export const RISK_TONE: Record<RiskLevel, string> = {
  low: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  medium: "bg-amber-500/15 text-amber-800 dark:text-amber-300",
  high: "bg-red-500/10 text-red-700 dark:text-red-300",
};

const tip = (r: Risk) => [`Risk ${r.score}/100 (${r.level})`, ...r.factors.map((f) => `${f.points > 0 ? "+" : ""}${f.points}  ${f.why}`), r.partial ? "Files not loaded yet: size only." : ""].filter(Boolean).join("\n");

// In lists only medium and high show, unless `always`.
export function RiskBadge({ risk, always = false }: { risk: Risk | null; always?: boolean }) {
  if (!risk || (!always && risk.level === "low")) return null;
  return (
    <span title={tip(risk)} className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[0.65rem] font-medium ${RISK_TONE[risk.level]}`}>
      <ShieldAlert size={10} /> {risk.score}
    </span>
  );
}

export function RiskBox({ risk, adjust }: { risk: Risk; adjust?: { adjust: number; why: string } | null }) {
  const final = adjust ? Math.max(0, Math.min(100, risk.score + adjust.adjust)) : risk.score;
  const level = levelOf(final);
  return (
    <section className="space-y-1.5 rounded-2xl border border-line bg-panel px-3.5 py-3">
      <h2 className="flex items-center gap-2 text-xs font-semibold">
        Risk
        <span className={`rounded px-1.5 py-0.5 text-[0.7rem] ${RISK_TONE[level]}`}>
          {final} · {level}
        </span>
      </h2>
      <ul className="space-y-0.5 text-xs">
        {risk.factors.map((f, i) => (
          <li key={i} className="flex gap-2">
            <span className={`w-7 shrink-0 text-right font-mono ${f.points < 0 ? "text-emerald-600" : "text-muted"}`}>
              {f.points > 0 ? "+" : ""}
              {f.points}
            </span>
            <span className="min-w-0 flex-1 break-words">{f.why}</span>
          </li>
        ))}
        {adjust && adjust.adjust !== 0 && (
          <li className="flex gap-2">
            <span className={`w-7 shrink-0 text-right font-mono ${adjust.adjust < 0 ? "text-emerald-600" : "text-violet-600 dark:text-violet-300"}`}>
              {adjust.adjust > 0 ? "+" : ""}
              {adjust.adjust}
            </span>
            <span className="min-w-0 flex-1 break-words">Claude: {adjust.why}</span>
          </li>
        )}
        {!risk.factors.length && !adjust?.adjust && <li className="text-muted">Nothing risky stands out.</li>}
      </ul>
      {risk.partial && <p className="text-[0.7rem] text-muted">File list not loaded yet: this counts size only.</p>}
    </section>
  );
}
