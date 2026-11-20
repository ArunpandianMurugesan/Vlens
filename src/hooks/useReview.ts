"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EMPTY_LIFECYCLE, type Lifecycle } from "@/lib/lifecycle";
import { type Risk, riskOf as scoreRisk } from "@/lib/risk";
import { addPrSession } from "@/lib/prSessions";
import { type News, type NewsTone, newsFor, readSeen, type Seen, snapshot, writeSeen } from "@/lib/prSeen";
import type { PrDetail, PrSummary, ReviewBoard } from "@/lib/types";

const POLL_MS = 10 * 60_000; // GitHub is polled lightly; the refresh button forces a fetch

// The inbox lists in the left panel: what's new, your own PRs, reviews asked of you.
export type InboxTab = "new" | "mine" | "reviews";
const TAB_KEY = "lens.prTab";
export const NEWS_RANK: Record<NewsTone, number> = { orange: 0, red: 1, green: 2, violet: 3, blue: 4 };

// State for the PR Review space: the PR board, which PR is open, and its details.
export function useReview() {
  const [board, setBoard] = useState<ReviewBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null); // PR url
  const [detail, setDetail] = useState<{ url: string; data?: PrDetail; error?: string } | null>(null);

  // Each PR's review lifecycle (lifecycle.ts): past reviews and posts, which PRs
  // re-review new commits by themselves, and what's running. All local, so polled often.
  const [life, setLife] = useState<Lifecycle | null>(null);
  const loadLife = useCallback(async () => {
    const d = await fetch("/api/review/lifecycle").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (d?.tracks) setLife(d);
  }, []);
  // Every 30 s; every 3 s while a review runs, so its steps move.
  const runningNow = !!life?.running.length;
  useEffect(() => {
    void loadLife();
    const t = setInterval(() => void loadLife(), runningNow ? 3_000 : 30_000);
    return () => clearInterval(t);
  }, [loadLife, runningNow]);
  // Auto reviews show as tabs on their PR, like the ones you start.
  useEffect(() => {
    if (!life) return;
    for (const r of life.running) if (r.sessionId) addPrSession(r.url, { id: r.sessionId, kind: "Auto review", at: Date.parse(r.startedAt) });
    for (const [url, t] of Object.entries(life.tracks)) if (t.lastRun?.by === "auto") addPrSession(url, { id: t.lastRun.sessionId, kind: "Auto review", at: Date.parse(t.lastRun.at) });
  }, [life]);
  // watch / unwatch: auto re-review for one PR. stop / retry: its running or failed review.
  const lifeAction = useCallback(async (action: "watch" | "unwatch" | "stop" | "retry", p: PrSummary): Promise<string | null> => {
    const r = await fetch("/api/review/lifecycle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, url: p.url, headSha: p.headSha }) })
      .then((x) => x.json())
      .catch(() => ({ error: "Couldn't reach Vlens." }));
    if (r?.tracks) setLife(r);
    else await loadLife();
    return r?.error ?? null;
  }, [loadLife]);
  const lifecycle = life ?? EMPTY_LIFECYCLE;
  // The PR's risk score (risk.ts).
  const riskOf = useCallback((p: PrSummary): Risk => scoreRisk(p), []);

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
    await Promise.all([load(true), loadLife(), selected ? select(selected) : Promise.resolve()]);
  }, [load, loadLife, select, selected]);

  // Every open PR shows: nothing is hidden.
  const prs: PrSummary[] = useMemo(() => board?.prs ?? [], [board]);
  const pr = prs.find((p) => p.url === selected) ?? null;

  // Which inbox list shows when no PR is open; the left panel picks it.
  const [inbox, setInboxState] = useState<InboxTab>("new");
  useEffect(() => {
    try {
      const t = localStorage.getItem(TAB_KEY);
      if (t === "mine" || t === "reviews" || t === "new") setInboxState(t);
    } catch {}
  }, []);
  // Back to a list: closes the open PR.
  const goInbox = useCallback((t?: InboxTab) => {
    setSelected(null);
    if (t) {
      setInboxState(t);
      try {
        localStorage.setItem(TAB_KEY, t);
      } catch {}
    }
  }, []);

  // "New": each PR compared with how it was when you last had it open (prSeen.ts).
  const [seen, setSeen] = useState<Record<string, Seen> | null>(null);
  useEffect(() => {
    if (seen || !board?.fetchedAt) return;
    let s = readSeen();
    // First time: everything you have now counts as seen, except reviews asked of you.
    if (!s) {
      s = Object.fromEntries(prs.filter((p) => p.lane !== "needsYou" && p.lane !== "team").map((p) => [p.url, snapshot(p)]));
      writeSeen(s);
    }
    setSeen(s);
  }, [board?.fetchedAt, prs, seen]);
  const markSeen = useCallback((list: PrSummary[]) => {
    setSeen((cur) => {
      const next = { ...(cur ?? {}), ...Object.fromEntries(list.map((p) => [p.url, snapshot(p)])) };
      writeSeen(next);
      return next;
    });
  }, []);
  // A PR counts as seen once you leave it (so it stays in "New" while you read it).
  const prev = useRef<PrSummary | null>(null);
  useEffect(() => {
    const was = prev.current;
    if (was && was.url !== pr?.url) markSeen([was]);
    prev.current = pr;
  }, [pr?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  const news = useMemo(
    () =>
      seen
        ? prs
            .map((p) => ({ p, n: newsFor(p, seen[p.url], life?.tracks[p.url]) }))
            .filter((x): x is { p: PrSummary; n: News } => !!x.n)
            .sort((a, b) => NEWS_RANK[a.n.tone] - NEWS_RANK[b.n.tone] || b.p.updatedAt.localeCompare(a.p.updatedAt))
        : [],
    [seen, prs, life],
  );
  const cloneFor = (p: PrSummary) => board?.clones[p.repo.toLowerCase()] ?? null;

  return { board, prs, loading, load, refresh, selected, pr, detail, select, cloneFor, life: lifecycle, lifeLoaded: !!life, loadLife, lifeAction, riskOf, inbox, goInbox, news, markSeen };
}

export type Review = ReturnType<typeof useReview>;
