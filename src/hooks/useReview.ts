"use client";

import { useCallback, useEffect, useState } from "react";
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
    // Same PR (a refresh): keep showing what we have until the new data lands.
    setDetail((cur) => (cur?.url === url && cur.data ? cur : { url }));
    const d = await fetch(`/api/review/pr?url=${encodeURIComponent(url)}`).then((r) => r.json()).catch(() => ({ error: "Couldn't load this PR." }));
    setDetail((cur) => (cur?.url === url ? (d.error ? { url, error: d.error } : { url, data: d }) : cur));
  }, []);

  // Fresh from GitHub: the PR list, plus the details of the PR you have open.
  const refresh = useCallback(async () => {
    await Promise.all([load(true), selected ? select(selected) : Promise.resolve()]);
  }, [load, select, selected]);

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

  return { board, prs, loading, load, refresh, selected, pr, detail, select, dismiss, cloneFor };
}

export type Review = ReturnType<typeof useReview>;
