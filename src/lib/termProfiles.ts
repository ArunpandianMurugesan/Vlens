"use client";

import { useSyncExternalStore } from "react";
import { TERM_COLORS_KEY, TERM_THEMES, termThemeById, type TermPalette } from "./termThemes";

// Terminal profiles, like Terminal.app's or iTerm2's: a colour scheme plus font,
// size, line height and cursor. Used by the Terminal panel and the CLI view.
// There's one built-in profile per colour scheme; your own profiles start as a
// copy of one and are saved in this browser.

export type CursorStyle = "block" | "bar" | "underline";

export interface TermProfile {
  id: string;
  name: string;
  scheme: string; // a TERM_THEMES id
  background?: string; // overrides the scheme's
  foreground?: string;
  cursor?: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  builtin?: boolean;
}

export const DEFAULT_FONT = 'ui-monospace, "SF Mono", Menlo, monospace';

// Offered in the font box; any installed font can be typed in.
export const FONT_SUGGESTIONS = [
  DEFAULT_FONT,
  "Menlo",
  "Monaco",
  '"SF Mono"',
  '"JetBrains Mono"',
  '"Fira Code"',
  '"Cascadia Code"',
  '"Source Code Pro"',
  '"IBM Plex Mono"',
  '"Courier New"',
];

const PROFILE_KEY = "lens.termProfile"; // the chosen profile's id
const CUSTOM_KEY = "lens.termProfiles"; // your own profiles

const defaults = { fontFamily: DEFAULT_FONT, fontSize: 12.5, lineHeight: 1, cursorStyle: "block" as CursorStyle, cursorBlink: true };

export const BUILTIN_PROFILES: TermProfile[] = TERM_THEMES.map((t) => ({
  id: t.id,
  name: t.palette ? t.label : "Vlens (match app)",
  scheme: t.id,
  ...defaults,
  ...t.profile,
  builtin: true,
}));

const listeners = new Set<() => void>();
const emit = () => {
  cache = null;
  listeners.forEach((l) => l());
};

let cache: { profiles: TermProfile[]; current: TermProfile } | null = null;

function readCustom(): TermProfile[] {
  try {
    const list = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]") as TermProfile[];
    return Array.isArray(list) ? list.filter((p) => p && typeof p.id === "string").map((p) => ({ ...defaults, ...p, builtin: false })) : [];
  } catch {
    return [];
  }
}

// The same objects until something changes, as useSyncExternalStore needs.
function snapshot() {
  if (cache) return cache;
  const profiles = [...BUILTIN_PROFILES, ...readCustom()];
  let id: string | null = null;
  try {
    id = localStorage.getItem(PROFILE_KEY);
  } catch {}
  cache = { profiles, current: profiles.find((p) => p.id === id) ?? BUILTIN_PROFILES[0] };
  return cache;
}

export const currentProfile = () => snapshot().current;

// The profile's colours: its scheme, with its own overrides on top. Null for a
// "match app" profile with no overrides, whose colours come from the stylesheet.
export function profileColors(p: TermProfile, dark = isDark()): Partial<TermPalette> | null {
  const scheme = termThemeById(p.scheme);
  const base = scheme.palette && dark && scheme.dark ? { ...scheme.palette, ...scheme.dark } : scheme.palette;
  const own: Partial<TermPalette> = {};
  if (p.background) own.background = p.background;
  if (p.foreground) own.foreground = p.foreground;
  if (p.cursor) own.cursor = p.cursor;
  if (!base && !Object.keys(own).length) return null;
  return { ...(base ?? {}), ...own };
}

const isDark = () => typeof document !== "undefined" && document.documentElement.dataset.theme === "dark";

// Puts the chosen profile's background and text colours on <html> as
// --term-profile-bg / --term-profile-text, which only the Terminal panel and CLI
// view use (the app's own --term-* stay as they are for code blocks and tool
// output), and saves them, for light and for dark, for the boot script.
function applyColors() {
  const p = currentProfile();
  const light = profileColors(p, false);
  const dark = profileColors(p, true);
  const c = isDark() ? dark : light;
  const rs = document.documentElement.style;
  try {
    if (light || dark) localStorage.setItem(TERM_COLORS_KEY, JSON.stringify([light?.background, light?.foreground, dark?.background, dark?.foreground]));
    else localStorage.removeItem(TERM_COLORS_KEY);
  } catch {}
  if (c?.background) rs.setProperty("--term-profile-bg", c.background);
  else rs.removeProperty("--term-profile-bg");
  if (c?.foreground) rs.setProperty("--term-profile-text", c.foreground);
  else rs.removeProperty("--term-profile-text");
}

// Is this profile's background light? Claude's own screen (the CLI view) takes
// its colours from Claude's theme setting, not the terminal's, so it can be faint
// on a light background.
export function isLightProfile(p: TermProfile, dark = isDark()) {
  const m = /^#([0-9a-f]{6})$/i.exec(profileColors(p, dark)?.background ?? "");
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140;
}

function saveCustom(list: TermProfile[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list.map((p) => ({ ...p, builtin: undefined }))));
  } catch {}
}

export function selectProfile(id: string) {
  try {
    if (id === BUILTIN_PROFILES[0].id) localStorage.removeItem(PROFILE_KEY);
    else localStorage.setItem(PROFILE_KEY, id);
  } catch {}
  emit();
  applyColors();
}

// A new profile copied from `from`, chosen right away.
export function duplicateProfile(from: TermProfile): TermProfile {
  const custom = readCustom();
  const copy: TermProfile = { ...from, builtin: false, id: `custom-${crypto.randomUUID()}`, name: `${from.name.replace(/ \(match app\)$/, "")} copy` };
  saveCustom([...custom, copy]);
  selectProfile(copy.id);
  return copy;
}

export function updateProfile(id: string, patch: Partial<TermProfile>) {
  const custom = readCustom();
  const i = custom.findIndex((p) => p.id === id);
  if (i < 0) return; // built-ins don't change
  custom[i] = { ...custom[i], ...patch, id };
  saveCustom(custom);
  emit();
  applyColors();
}

export function deleteProfile(id: string) {
  saveCustom(readCustom().filter((p) => p.id !== id));
  if (currentProfile().id === id) selectProfile(BUILTIN_PROFILES[0].id);
  else emit();
}

// A profile can look different in light and dark (Terminal.app's Basic does):
// follow the app when it switches. And another Vlens window can change the
// profiles: drop the cached snapshot even when nothing here is subscribed yet,
// so new terminals open with the current profile.
let following = false;
function follow() {
  if (following) return;
  following = true;
  new MutationObserver(applyColors).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  window.addEventListener("storage", (e) => {
    if (e.key === PROFILE_KEY || e.key === CUSTOM_KEY || e.key === null) {
      emit();
      applyColors();
    }
  });
}

export function subscribeProfiles(cb: () => void) {
  follow();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const server = { profiles: BUILTIN_PROFILES, current: BUILTIN_PROFILES[0] };
export const useTermProfiles = () => useSyncExternalStore(subscribeProfiles, snapshot, () => server);

if (typeof window !== "undefined") follow();
