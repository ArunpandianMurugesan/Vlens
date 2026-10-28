"use client";

import { useSyncExternalStore } from "react";
import { ACCENT_KEY, THEME_KEY } from "./themeScript";

// Theme choice, saved in this browser. "system" follows the Mac's setting live.
export type ThemePref = "system" | "light" | "dark";
export type Theme = "light" | "dark";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function readPref(): ThemePref {
  try {
    const p = localStorage.getItem(THEME_KEY);
    return p === "light" || p === "dark" ? p : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const resolve = (p: ThemePref): Theme => (p === "dark" || (p === "system" && systemDark()) ? "dark" : "light");

function apply() {
  document.documentElement.dataset.theme = resolve(readPref());
  emit();
}

export function setThemePref(p: ThemePref) {
  try {
    localStorage.setItem(THEME_KEY, p);
  } catch {}
  apply();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  // While on "system", follow the Mac when it switches (e.g. at sunset).
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => readPref() === "system" && apply();
  mq.addEventListener("change", onSystem);
  return () => {
    listeners.delete(cb);
    mq.removeEventListener("change", onSystem);
  };
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, readPref, () => "system");
}

// The theme actually showing, after "system" is worked out.
export function useTheme(): Theme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"),
    () => "light",
  );
}

// Accent colour, also saved in this browser. "orange" is the default and needs no attribute.
export const ACCENTS = [
  { id: "orange", label: "Orange", swatch: "#c96442" },
  { id: "blue", label: "Blue", swatch: "#2f6fd1" },
  { id: "green", label: "Green", swatch: "#2b7d4f" },
  { id: "purple", label: "Purple", swatch: "#7c4dcc" },
  { id: "pink", label: "Pink", swatch: "#c2407e" },
  { id: "teal", label: "Teal", swatch: "#12808a" },
] as const;
export type Accent = (typeof ACCENTS)[number]["id"];

function readAccent(): Accent {
  try {
    const a = localStorage.getItem(ACCENT_KEY);
    return ACCENTS.some((x) => x.id === a) ? (a as Accent) : "orange";
  } catch {
    return "orange";
  }
}

export function setAccent(a: Accent) {
  try {
    if (a === "orange") localStorage.removeItem(ACCENT_KEY);
    else localStorage.setItem(ACCENT_KEY, a);
  } catch {}
  if (a === "orange") delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = a;
  emit();
}

export function useAccent(): Accent {
  return useSyncExternalStore(subscribe, readAccent, () => "orange");
}
