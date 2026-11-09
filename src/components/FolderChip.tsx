"use client";

import { Check, ChevronDown, Folder, FolderOpen, House, Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { chooseFolder } from "@/lib/chooseFolder";

// Which folder a new session runs in: a chip in the message box. Pick one of the
// folders you worked in lately, or choose any folder in the Mac's own folder window.
// Home and New session share it, and the last folder you picked (lens.homeFolder).

export const LAST_FOLDER_KEY = "lens.homeFolder";

export function lastFolder(): string {
  try {
    return localStorage.getItem(LAST_FOLDER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function rememberFolder(path: string) {
  try {
    localStorage.setItem(LAST_FOLDER_KEY, path);
  } catch {}
}

const HOME = /^\/Users\/[^/]+/;
const TEMP = /^\/(private\/)?(tmp|var\/folders)\/|\/Application Support\/Vlens\/bots\//; // and your bots' own folders
const tilde = (p: string) => p.replace(HOME, "~");
const name = (p: string) => (p.replace(HOME, "") === "" ? "Home" : (p.split("/").filter(Boolean).pop() ?? p));
const parent = (p: string) => tilde(p.split("/").slice(0, -1).join("/") || "/");

// down: open the list below the chip (when it sits near the top, like on Home).
export function FolderChip({ value, onChange, recent, down }: { value: string; onChange: (path: string) => void; recent: string[]; down?: boolean }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);
  useEffect(() => {
    if (open) {
      setQ("");
      setErr(null);
      setHi(0);
    }
  }, [open]);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    // Temporary folders (scratch space, test runs) aren't places you'd start a session.
    const all = [...new Set([...(value ? [value] : []), ...recent])].filter((p) => !TEMP.test(p)).slice(0, 12);
    return s ? all.filter((p) => tilde(p).toLowerCase().includes(s)) : all;
  }, [q, recent, value]);

  const pick = (p: string) => {
    rememberFolder(p);
    onChange(p);
    setOpen(false);
  };
  const browse = async () => {
    setBusy(true);
    setErr(null);
    try {
      const p = await chooseFolder(value || null);
      if (p) pick(p);
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };
  // A typed or pasted path: use it if it's a folder.
  const typedPath = /^[~/]/.test(q.trim()) ? q.trim() : null;
  const applyTyped = async () => {
    if (!typedPath) return;
    const r = await fetch(`/api/folders?path=${encodeURIComponent(typedPath)}`);
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setErr(d.error ?? "Not a folder");
    pick(d.path);
  };

  const row = "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs";
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={value ? `${value}\nClick to change the folder` : "Pick the folder Claude works in"}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex max-w-56 items-center gap-1 rounded-lg px-1.5 py-0.5 text-[0.7rem] ${value ? "bg-accent-soft text-accent" : "bg-sunken text-muted hover:text-ink"}`}
      >
        <FolderOpen size={11} className="shrink-0" />
        <span className="truncate">{value ? name(value) : "Pick a folder"}</span>
        <ChevronDown size={11} className="shrink-0" />
      </button>

      {open && (
        <div className={`absolute left-0 z-50 w-80 ${down ? "top-full mt-1.5" : "bottom-full mb-1.5"} overflow-hidden rounded-xl border border-line bg-panel shadow-xl`}>
          <div className="flex items-center gap-2 border-b border-line px-3 py-2">
            <Search size={13} className="shrink-0 text-muted" />
            <input
              autoFocus
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setHi(0);
                setErr(null);
              }}
              onKeyDown={(e) => {
                const n = list.length + 1; // the list, then Choose folder…
                if (e.key === "Escape") setOpen(false);
                else if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHi((h) => (h + 1) % n);
                }
                else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHi((h) => (h - 1 + n) % n);
                }
                else if (e.key === "Enter") {
                  e.preventDefault();
                  if (typedPath) void applyTyped();
                  else if (hi < list.length) pick(list[hi]);
                  else void browse();
                }
              }}
              placeholder="Search, or paste a path"
              spellCheck={false}
              className="min-w-0 flex-1 bg-transparent text-xs outline-none"
            />
          </div>
          <div role="listbox" className="max-h-72 overflow-y-auto py-1 scroll-thin">
            {typedPath && (
              <button onClick={() => void applyTyped()} className={`${row} bg-sunken`}>
                <Folder size={13} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate font-mono">{typedPath}</span>
                <span className="shrink-0 text-muted">↩ use</span>
              </button>
            )}
            {!typedPath && list.length > 0 && <div className="px-3 pb-1 pt-1.5 text-[0.65rem] font-medium text-muted">Recent</div>}
            {!typedPath &&
              list.map((p, i) => (
                <button
                  key={p}
                  role="option"
                  aria-selected={p === value}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => pick(p)}
                  title={p}
                  className={`${row} ${hi === i ? "bg-sunken" : ""}`}
                >
                  {name(p) === "Home" ? <House size={13} className="shrink-0 text-muted" /> : <Folder size={13} className="shrink-0 text-muted" />}
                  <span className="shrink-0 font-medium">{name(p)}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-muted">{name(p) === "Home" ? "~" : parent(p)}</span>
                  <span className="w-3 shrink-0">{p === value && <Check size={12} className="text-accent" />}</span>
                </button>
              ))}
            {!typedPath && q && !list.length && <p className="px-3 py-2 text-xs text-muted">No recent folder matches. Choose one below.</p>}
          </div>
          <button
            onClick={() => void browse()}
            onMouseEnter={() => setHi(list.length)}
            disabled={busy}
            className={`${row} border-t border-line py-2 ${hi === list.length && !typedPath ? "bg-sunken" : ""}`}
          >
            {busy ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <FolderOpen size={13} className="shrink-0 text-muted" />}
            <span className="flex-1">Choose folder…</span>
            <span className="text-muted">Mac folder window</span>
          </button>
          {err && <p className="border-t border-line px-3 py-1.5 text-[0.7rem] text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
}
