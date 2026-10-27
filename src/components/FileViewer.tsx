"use client";

import { Check, Code2, Copy, Eye, File as FileIcon, Folder, FolderSearch, Loader2, Maximize2, Minimize2, RefreshCw, SquareArrowOutUpRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FileView } from "@/lib/types";
import { type FileTab, useFiles } from "./FileContext";
import { Markdown } from "./Markdown";

const size = (n?: number) => (n === undefined ? "" : n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n > 1e3 ? `${Math.round(n / 1e3)} KB` : `${n} B`);

// Which lines to highlight: where `find` appears, or a single line.
function targetLines(t: FileTab): [number, number] | null {
  const text = t.view?.text;
  if (!text) return null;
  if (t.find) {
    const at = text.indexOf(t.find);
    if (at >= 0) {
      const start = text.slice(0, at).split("\n").length;
      return [start, start + t.find.split("\n").length - 1];
    }
  }
  return t.line ? [t.line, t.line] : null;
}

function Breadcrumb({ view, onOpen }: { view: FileView; onOpen: (p: string) => void }) {
  const rel = view.path.startsWith(view.home) ? view.path.slice(view.home.length + 1) : view.path;
  const parts = rel.split("/").filter(Boolean);
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden text-xs text-muted" title={view.path}>
      {parts.map((p, i) => {
        const last = i === parts.length - 1;
        const full = `${view.home}/${parts.slice(0, i + 1).join("/")}`;
        return (
          <span key={full} className="flex min-w-0 items-center gap-1">
            {i > 0 && <span className="opacity-50">/</span>}
            {last ? (
              <span className="truncate text-ink">{p}</span>
            ) : (
              <button onClick={() => onOpen(full)} className="truncate hover:text-accent hover:underline">
                {p}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

function Code({ tab }: { tab: FileTab }) {
  const ref = useRef<HTMLDivElement>(null);
  const range = targetLines(tab);
  const key = `${tab.view?.mtime}-${range?.join("-")}`;

  // Mark the target lines and bring the first one into view.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll(".line.hl").forEach((l) => l.classList.remove("hl"));
    if (!range) {
      el.scrollTo({ top: 0 }); // (returns a Promise in newer browsers: don't return it from the effect)
      return;
    }
    let first: Element | null = null;
    for (let n = range[0]; n <= range[1]; n++) {
      const l = el.querySelector(`.line[data-line="${n}"]`);
      l?.classList.add("hl");
      first ??= l;
    }
    first?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div ref={ref} className="code-view h-full overflow-auto scroll-thin">
      {/* Shiki's output, highlighted on the server from your local file. */}
      <div dangerouslySetInnerHTML={{ __html: tab.view!.html! }} />
    </div>
  );
}

function Body({ tab, onOpen }: { tab: FileTab; onOpen: (p: string) => void }) {
  const [preview, setPreview] = useState(true);
  const v = tab.view;
  if (tab.error) return <p className="m-4 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600">{tab.error}</p>;
  if (!v)
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" /> Opening…
      </div>
    );
  switch (v.kind) {
    case "missing":
      return <p className="p-4 text-sm text-muted">This file doesn&apos;t exist (anymore). Claude may have moved or deleted it.</p>;
    case "binary":
      return <p className="p-4 text-sm text-muted">This is a binary file ({size(v.size)}), so there&apos;s nothing to show here.</p>;
    case "too-big":
      return <p className="p-4 text-sm text-muted">This file is {size(v.size)}, too big to show here. Open it in your editor instead.</p>;
    case "image":
      return (
        <div className="flex h-full items-center justify-center overflow-auto p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- local file preview */}
          <img src={`/api/file/raw?path=${encodeURIComponent(v.path)}&t=${v.mtime}`} alt={v.name} className="max-h-full max-w-full rounded-lg border border-line" />
        </div>
      );
    case "dir":
      return (
        <ul className="p-2">
          {v.entries?.map((e) => (
            <li key={e.name}>
              <button onClick={() => onOpen(`${v.path}/${e.name}`)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-sunken">
                {e.dir ? <Folder size={14} className="shrink-0 text-accent" /> : <FileIcon size={14} className="shrink-0 text-muted" />}
                <span className="truncate">{e.name}</span>
              </button>
            </li>
          ))}
          {!v.entries?.length && <li className="p-2 text-sm text-muted">Empty folder.</li>}
        </ul>
      );
    case "text": {
      const md = v.lang === "markdown" || v.lang === "mdx";
      return (
        <div className="relative h-full">
          {md && (
            <div className="absolute right-3 top-2 z-10 flex rounded-lg bg-sunken p-0.5 text-xs shadow-sm">
              {(
                [
                  [true, "Preview", Eye],
                  [false, "Code", Code2],
                ] as const
              ).map(([p, label, Icon]) => (
                <button key={label} onClick={() => setPreview(p)} className={`flex items-center gap-1 rounded-md px-2 py-0.5 ${preview === p ? "bg-panel text-ink" : "text-muted hover:text-ink"}`}>
                  <Icon size={11} /> {label}
                </button>
              ))}
            </div>
          )}
          {md && preview ? (
            <div className="h-full overflow-auto px-6 py-4 scroll-thin">
              <Markdown text={v.text ?? ""} />
            </div>
          ) : (
            <Code tab={tab} />
          )}
        </div>
      );
    }
  }
}

export function FileViewer() {
  const files = useFiles()!;
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tab = files.tabs.find((t) => t.key === files.active) ?? files.tabs[0];
  if (!tab) return null;
  const v = tab.view;
  const line = targetLines(tab)?.[0];

  const external = async (how: "editor" | "finder") => {
    if (!v) return;
    setErr(null);
    const res = await fetch("/api/file/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: v.path, how, line }) });
    if (!res.ok) setErr((await res.json().catch(() => null))?.error ?? "Couldn't open it.");
  };
  const icon = "rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink disabled:opacity-40";

  return (
    <section className="flex h-full min-w-0 flex-col bg-panel">
      {/* Tabs and actions */}
      <div className="flex items-center gap-1 border-b border-line px-2 py-1.5">
        <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto scroll-thin">
          {files.tabs.map((t) => (
            <div
              key={t.key}
              className={`group flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs ${t.key === tab.key ? "bg-sunken text-ink" : "text-muted hover:text-ink"}`}
            >
              <button onClick={() => files.activate(t.key)} className="max-w-48 truncate italic" title={t.view?.path ?? t.key}>
                {t.view?.name ?? t.key.split("/").pop()}
              </button>
              {t.loading && <Loader2 size={11} className="animate-spin" />}
              <button onClick={() => files.close(t.key)} className="rounded p-0.5 opacity-60 hover:bg-panel hover:opacity-100" aria-label={`Close ${t.view?.name ?? t.key}`}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <button className={icon} onClick={() => files.reload(tab.key)} title="Reload from disk" aria-label="Reload">
          <RefreshCw size={14} />
        </button>
        <button
          className={icon}
          disabled={!v}
          onClick={() => {
            if (!v) return;
            void navigator.clipboard.writeText(v.path);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          title="Copy path"
          aria-label="Copy path"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
        <button className={icon} disabled={!v} onClick={() => external("editor")} title="Open in editor" aria-label="Open in editor">
          <SquareArrowOutUpRight size={14} />
        </button>
        <button className={icon} disabled={!v} onClick={() => external("finder")} title="Reveal in Finder" aria-label="Reveal in Finder">
          <FolderSearch size={14} />
        </button>
        <button className={icon} onClick={() => files.setMaximized(!files.maximized)} title={files.maximized ? "Show the chat too" : "Fill the window"} aria-label="Toggle full width">
          {files.maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        <button className={icon} onClick={files.closeAll} title="Close all files" aria-label="Close all files">
          <X size={15} />
        </button>
      </div>

      {v && (
        <div className="flex items-center gap-2 border-b border-line px-4 py-2">
          <Breadcrumb view={v} onOpen={(p) => files.open(p)} />
          <span className="ml-auto shrink-0 text-[0.7rem] text-muted">
            {v.kind === "text" ? `${v.lines} lines · ${v.lang}` : size(v.size)}
          </span>
        </div>
      )}
      {err && <p className="mx-3 mt-2 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs text-red-600">{err}</p>}

      <div className="min-h-0 flex-1">
        <Body tab={tab} onOpen={(p) => files.open(p)} />
      </div>
    </section>
  );
}
