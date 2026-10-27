"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { setThemePref, type ThemePref, useThemePref } from "@/lib/theme";

export const THEMES: { id: ThemePref; label: string; icon: typeof Sun }[] = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

// One small button that cycles System → Light → Dark.
export function ThemeToggle() {
  const pref = useThemePref();
  const i = THEMES.findIndex((t) => t.id === pref);
  const { icon: Icon, label } = THEMES[i];
  const next = THEMES[(i + 1) % THEMES.length];
  return (
    <button
      onClick={() => setThemePref(next.id)}
      title={`Theme: ${label} (click for ${next.label})`}
      aria-label={`Theme: ${label}. Switch to ${next.label}`}
      className="rounded-md p-1.5 text-muted hover:bg-panel hover:text-ink"
    >
      <Icon size={15} />
    </button>
  );
}

// The full three-way choice, for Settings.
export function ThemePicker() {
  const pref = useThemePref();
  return (
    <div className="flex rounded-lg bg-sunken p-0.5 text-xs" role="radiogroup" aria-label="Theme">
      {THEMES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          role="radio"
          aria-checked={pref === id}
          onClick={() => setThemePref(id)}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition ${pref === id ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          <Icon size={12} /> {label}
        </button>
      ))}
    </div>
  );
}
