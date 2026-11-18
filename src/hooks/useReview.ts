"use client";

import { useCallback, useEffect, useState } from "react";
import { type AutopilotRules, type AutopilotState, DEFAULT_RULES, type Plan, planFor } from "@/lib/autopilotPlan";
import { type Risk, riskOf as scoreRisk } from "@/lib/risk";
import type { PrDetail, PrSummary, ReviewBoard } from "@/lib/types";

const DISMISSED_KEY = "lens.dismissedPRs";
const POLL_MS = 10 * 60_000; // GitHub is polled lightly; the refresh button forces a fetch

function readDismissed(): Set<string> {
  try {
    const a = JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
    return new Set(Array.isArray(a) ? a : []);
  } catch {
    return new Set();
  }
}

// State for the Vlens Review tab: the PR board, which PR is open, and its details.
export function useReview() {
  const [board, setBoard] = useState<ReviewBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null); // PR url
  const [detail, setDetail] = useState<{ url: string; data?: PrDetail; error?: string } | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => setDismissed(readDismissed()), []);

  // Autopilot: its rules, log and each PR's past reviews (all local, so polled often).
  const [auto, setAuto] = useState<AutopilotState | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false); // the Autopilot board, in the main area
  const loadAuto = useCallback(async () => {
    const d = await fetch("/api/autopilot").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d?.rules) setAuto(d);
  }, []);
  useEffect(() => {
    void loadAuto();
    const t = setInterval(() => void loadAuto(), 30_000);
    return () => clearInterval(t);
  }, [loadAuto]);
  const saveRules = useCallback(
    async (rules: AutopilotRules) => {
      const r = await fetch("/api/autopilot/rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rules) });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? r.statusText);
      await loadAuto();
    },
    [loadAuto],
  );
  const setPaused = useCallback(
    async (p: PrSummary, paused: boolean) => {
      await fetch("/api/autopilot/pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: p.url, title: p.title, paused }) });
      await loadAuto();
    },
    [loadAuto],
  );
  const planOf = useCallback((p: PrSummary): Plan | null => (auto ? planFor(p, auto) : null), [auto]);
  // The PR's risk score (risk.ts), with your sensitive paths from the autopilot settings.
  const riskOf = useCallback((p: PrSummary): Risk => scoreRisk(p, auto?.rules.sensitivePaths ?? DEFAULT_RULES.sensitivePaths), [auto]);

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      setBoard(await fetch(`/api/review${fresh ? "?fresh=1" : ""}`).then((r) => r.json()));
    } catch {
      setBoard((b) => ({ ...(b ?? { login: null, prs: [], fetchedAt: null, clones: {} }), error: "Couldn't reach Vlens." }));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const select = useCallback(async (url: string) => {
    setSelected(url);
    setRulesOpen(false);
    setBoardOpen(false);
    // Same PR (a refresh): keep showing what we have until the new data lands.
    setDetail((cur) => (cur?.url === url && cur.data ? cur : { url }));
    const d = await fetch(`/api/review/pr?url=${encodeURIComponent(url)}`).then((r) => r.json()).catch(() => ({ error: "Couldn't load this PR." }));
    setDetail((cur) => (cur?.url === url ? (d.error ? { url, error: d.error } : { url, data: d }) : cur));
  }, []);

  // Fresh from GitHub: the PR list, plus the details of the PR you have open.
  const refresh = useCallback(async () => {
    await Promise.all([load(true), loadAuto(), selected ? select(selected) : Promise.resolve()]);
  }, [load, loadAuto, select, selected]);

  const dismiss = useCallback((url: string) => {
    setDismissed((prev) => {
      const next = new Set(prev).add(url);
      try {
        localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
    setSelected((s) => (s === url ? null : s));
  }, []);

  const prs: PrSummary[] = (board?.prs ?? []).filter((p) => !dismissed.has(p.url));
  const pr = prs.find((p) => p.url === selected) ?? null;
  const cloneFor = (p: PrSummary) => board?.clones[p.repo.toLowerCase()] ?? null;

  return { board, prs, loading, load, refresh, selected, pr, detail, select, dismiss, cloneFor, auto, loadAuto, saveRules, setPaused, planOf, riskOf, rulesOpen, setRulesOpen, boardOpen, setBoardOpen };
}

export type Review = ReturnType<typeof useReview>;
