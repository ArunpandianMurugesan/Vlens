"use client";

import { Copy, Trash2 } from "lucide-react";
import {
  type CursorStyle,
  deleteProfile,
  duplicateProfile,
  FONT_SUGGESTIONS,
  profileColors,
  selectProfile,
  type TermProfile,
  updateProfile,
  useTermProfiles,
} from "@/lib/termProfiles";
import { useTheme } from "@/lib/theme";
import { TERM_THEMES, termThemeById, VLENS_TERM } from "@/lib/termThemes";

// Terminal profiles, for Settings > Appearance: pick one, or copy one to make your own.

const btn = "inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs hover:border-accent hover:text-accent";
const input = "rounded-lg border border-line bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent";

function Preview({ p }: { p: TermProfile }) {
  const c = profileColors(p);
  const app = useTheme() === "dark" ? VLENS_TERM.dark : VLENS_TERM.light;
  const fg = c?.foreground ?? app.foreground;
  const dots = c?.red ? [c.red, c.green, c.yellow, c.blue, c.magenta, c.cyan] : [c?.cursor ?? "var(--accent)"];
  return (
    <div className="px-2.5 py-2" style={{ background: c?.background ?? app.background, color: fg, fontFamily: p.fontFamily }}>
      <div className="truncate text-xs">
        <span style={{ color: c?.green ?? fg }}>~</span> $ ls
        <span
          className="ml-0.5 inline-block align-middle"
          style={{
            background: c?.cursor ?? "var(--accent)",
            width: p.cursorStyle === "bar" ? 2 : "0.55em",
            height: p.cursorStyle === "underline" ? 2 : "1em",
            verticalAlign: p.cursorStyle === "underline" ? "bottom" : "middle",
          }}
        />
      </div>
      <div className="mt-1 flex gap-1">
        {dots.map((d, i) => (
          <span key={i} className="h-2 w-2 rounded-full" style={{ background: d }} />
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {children}
    </label>
  );
}

// A colour that can fall back to the scheme's: tick to override.
function ColorField({ label, value, fallback, onChange }: { label: string; value?: string; fallback: string; onChange: (v?: string) => void }) {
  return (
    <Field label={label}>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value ?? fallback}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-line bg-bg p-0.5"
        />
        {value ? (
          <button className="text-xs text-accent hover:underline" onClick={() => onChange(undefined)}>
            Use scheme&apos;s
          </button>
        ) : (
          <span className="text-xs">Scheme&apos;s</span>
        )}
      </span>
    </Field>
  );
}

function Editor({ p }: { p: TermProfile }) {
  const set = (patch: Partial<TermProfile>) => updateProfile(p.id, patch);
  const dark = useTheme() === "dark";
  const base = profileColors({ ...p, background: undefined, foreground: undefined, cursor: undefined }, dark);
  const css = (n: string) => (typeof window === "undefined" ? "#000000" : getComputedStyle(document.documentElement).getPropertyValue(n).trim());
  // <input type=color> only takes #rrggbb.
  const hex = (v: string | undefined, fb: string) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : fb);
  return (
    <div className="mt-3 grid w-full gap-3 rounded-xl border border-line bg-sunken/50 p-3 sm:grid-cols-2">
      <Field label="Name">
        <input className={input} value={p.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label="Colour scheme">
        <select className={input} value={p.scheme} onChange={(e) => set({ scheme: e.target.value })}>
          {(
            [
              ["Popular schemes", TERM_THEMES.filter((t) => !t.group)],
              ["macOS Terminal", TERM_THEMES.filter((t) => t.group === "terminal-app")],
            ] as const
          ).map(([label, list]) => (
            <optgroup key={label} label={label}>
              {list.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.palette ? t.label : "Vlens (match app)"}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Field>
      <Field label="Font">
        <input className={input} list="term-fonts" value={p.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })} />
        <datalist id="term-fonts">
          {FONT_SUGGESTIONS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
      </Field>
      <div className="flex gap-3">
        <Field label="Size">
          <input
            className={`${input} w-20`}
            type="number"
            min={8}
            max={32}
            step={0.5}
            value={p.fontSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 8 && v <= 32) set({ fontSize: v });
            }}
          />
        </Field>
        <Field label="Line height">
          <input
            className={`${input} w-20`}
            type="number"
            min={1}
            max={2}
            step={0.05}
            value={p.lineHeight}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= 1 && v <= 2) set({ lineHeight: v });
            }}
          />
        </Field>
      </div>
      <Field label="Cursor">
        <span className="flex items-center gap-3">
          <span className="flex rounded-lg bg-sunken p-0.5 text-xs" role="radiogroup" aria-label="Cursor style">
            {(["block", "bar", "underline"] as CursorStyle[]).map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={p.cursorStyle === c}
                onClick={() => set({ cursorStyle: c })}
                className={`rounded-md px-2.5 py-1 capitalize ${p.cursorStyle === c ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {c}
              </button>
            ))}
          </span>
          <label className="flex items-center gap-1.5 text-ink">
            <input type="checkbox" checked={p.cursorBlink} onChange={(e) => set({ cursorBlink: e.target.checked })} /> Blink
          </label>
        </span>
      </Field>
      <div className="flex flex-wrap gap-4 sm:col-span-2">
        <ColorField label="Background" value={p.background} fallback={hex(base?.background, VLENS_TERM[dark ? "dark" : "light"].background)} onChange={(v) => set({ background: v })} />
        <ColorField label="Text" value={p.foreground} fallback={hex(base?.foreground, VLENS_TERM[dark ? "dark" : "light"].foreground)} onChange={(v) => set({ foreground: v })} />
        <ColorField label="Cursor colour" value={p.cursor} fallback={hex(base?.cursor, hex(css("--accent"), "#c96442"))} onChange={(v) => set({ cursor: v })} />
      </div>
    </div>
  );
}

export function TermProfileSettings() {
  const { profiles, current } = useTermProfiles();
  const group = (p: TermProfile) => (p.builtin ? termThemeById(p.scheme).group : "custom");
  const groups: [string, TermProfile[]][] = [
    ["Popular schemes", profiles.filter((p) => p.builtin && !group(p))],
    ["macOS Terminal", profiles.filter((p) => group(p) === "terminal-app")],
    ["Yours", profiles.filter((p) => !p.builtin)],
  ];
  return (
    <div className="w-full">
      <div role="radiogroup" aria-label="Terminal profile" className="space-y-3">
        {groups.map(([title, list]) =>
          list.length ? (
            <div key={title}>
              <div className="mb-1.5 text-xs font-medium text-muted">{title}</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {list.map((p) => (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={current.id === p.id}
                    title={`${p.name}: ${p.fontFamily.split(",")[0].replace(/"/g, "")} ${p.fontSize}`}
                    onClick={() => selectProfile(p.id)}
                    className={`overflow-hidden rounded-lg border text-left text-xs transition ${current.id === p.id ? "border-accent ring-1 ring-accent" : "border-line hover:border-muted"}`}
                  >
                    <Preview p={p} />
                    <div className={`truncate px-2.5 py-1 ${current.id === p.id ? "text-accent" : "text-muted"}`}>{p.name || "Untitled"}</div>
                  </button>
                ))}
              </div>
            </div>
          ) : null,
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={btn} onClick={() => duplicateProfile(current)}>
          <Copy size={12} /> {current.builtin ? "Customize a copy" : "Duplicate"}
        </button>
        {!current.builtin && (
          <button className={`${btn} hover:border-red-500 hover:text-red-500`} onClick={() => deleteProfile(current.id)}>
            <Trash2 size={12} /> Delete
          </button>
        )}
        {current.builtin && <span className="text-xs text-muted">Built-in profiles can&apos;t be edited. Copy one to set your own font, size, cursor and colours.</span>}
      </div>
      {!current.builtin && <Editor p={current} />}
    </div>
  );
}
