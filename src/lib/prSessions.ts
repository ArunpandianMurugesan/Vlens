"use client";

import { useSyncExternalStore } from "react";

// Which Vlens sessions were started from which PR in Vlens Review, so each PR
// shows its own tabs (Self-review, Address feedback, …) and you can carry on
// those chats there. Kept in this browser only; the sessions themselves are
// ordinary Claude Code sessions.
export interface PrSession {
  id: string;
  kind: string; // the button that started it, e.g. "Self-review"
  at: number;
}

const KEY = "lens.prSessions";
const listeners = new Set<() => void>();
let cache: Record<string, PrSession[]> | null = null;

function read(): Record<string, PrSession[]> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    cache = {};
  }
  return cache!;
}

export function addPrSession(url: string, s: PrSession) {
  const all = read();
  cache = { ...all, [url]: [...(all[url] ?? []).filter((x) => x.id !== s.id), s] };
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {}
  for (const l of listeners) l();
}

const EMPTY: PrSession[] = [];
export function usePrSessions(url: string | undefined) {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => (url && read()[url]) || EMPTY,
    () => EMPTY,
  );
}
