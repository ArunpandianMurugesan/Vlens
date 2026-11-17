"use client";

import { Copy, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type CursorStyle,
  deleteProfile,
  duplicateProfile,
  FONT_SUGGESTIONS,
  isLightProfile,
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
  const dark = useTheme() === "dark";
  const c = profileColors(p, dark);
  const app = dark ? VLENS_TERM.dark : VLENS_TERM.light;
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

// A number box you can type into: the text is yours while you type (so "1" on
// the way to "14" isn't thrown away), and an in-range value applies right away
// (so the arrows still work live). On blur or Enter it's clamped and applied.
function NumberField({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);
  const commit = () => {
    editing.current = false;
    const v = Number(text);
    const next = text.trim() === "" || !Number.isFinite(v) ? value : Math.min(max, Math.max(min, v));
    setText(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <input
      className={`${input} w-20`}
      type="number"
      min={min}
      max={max}
      step={step}
      value={text}
      onFocus={() => (editing.current = true)}
      onChange={(e) => {
        setText(e.target.value);
        const v = Number(e.target.value);
        if (e.target.value.trim() !== "" && v >= min && v <= max && v !== value) onChange(v);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
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
          <NumberField value={p.fontSize} min={8} max={32} step={0.5} onChange={(fontSize) => set({ fontSize })} />
        </Field>
        <Field label="Line height">
          <NumberField value={p.lineHeight} min={1} max={2} step={0.05} onChange={(lineHeight) => set({ lineHeight })} />
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
  const dark = useTheme() === "dark";
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
      {isLightProfile(current, dark) && (
        <p className="mt-2 text-xs text-muted">
          The CLI view shows Claude Code&apos;s own screen, which takes its colours from Claude&apos;s theme, not the terminal&apos;s. With a light profile, set a light
          theme in Claude too (<code>/theme</code>), or its text can be faint.
        </p>
      )}
      {!current.builtin && <Editor p={current} />}
    </div>
  );
}
