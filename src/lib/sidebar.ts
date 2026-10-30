"use client";

import { useSyncExternalStore } from "react";
import { SIDEBAR_KEY } from "./themeScript";

// Whether the sidebar is slid away on a wide window. It lives on <html
// data-sidebar> and CSS does the moving (globals.css), so toggling it doesn't
// re-render the app: with a long session open that took seconds.
//   "hiding"    slides out over the page, then becomes "collapsed"
//   "collapsed" out of the layout; the page gets the full width
//   "showing"   for one layout pass: back in the layout but off-screen, so it slides in
const root = () => document.documentElement;
const listeners = new Set<() => void>();
const SLIDE_MS = 200;

export const isCollapsed = () => {
  const s = root().dataset.sidebar;
  return s === "collapsed" || s === "hiding";
};

export function setCollapsed(v: boolean) {
  if (v === isCollapsed()) return;
  const el = root();
  try {
    if (v) localStorage.setItem(SIDEBAR_KEY, "1");
    else localStorage.removeItem(SIDEBAR_KEY);
  } catch {}
  if (v) {
    el.dataset.sidebar = "hiding";
    setTimeout(() => el.dataset.sidebar === "hiding" && (el.dataset.sidebar = "collapsed"), SLIDE_MS);
  } else {
    // Lay it out off-screen first, then let it slide in from there.
    el.dataset.sidebar = "showing";
    document.querySelector(".lens-sidebar")?.getBoundingClientRect();
    delete el.dataset.sidebar;
  }
  for (const l of listeners) l();
}

export const toggleSidebar = () => setCollapsed(!isCollapsed());

export function useSidebarCollapsed() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    isCollapsed,
    () => false,
  );
}
