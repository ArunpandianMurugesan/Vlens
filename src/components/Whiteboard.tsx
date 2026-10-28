"use client";

import "@excalidraw/excalidraw/index.css";
import { Check, Copy, Download, ImageDown, Loader2, PenLine, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/lib/theme";

// Excalidraw loads its fonts from here (shipped with Vlens, so it works offline).
if (typeof window !== "undefined") (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw-assets/";

// The canvas touches `window`, so it only loads in the browser, and only when a board appears.
const Excalidraw = dynamic(() => import("@excalidraw/excalidraw").then((m) => m.Excalidraw), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 text-xs text-muted">
      <Loader2 size={14} className="animate-spin" /> Loading whiteboard…
    </div>
  ),
});

// Excalidraw's element type is internal; Vlens only passes elements through to it.
type Elements = readonly unknown[];
type Skeleton = Record<string, unknown> & { type?: string; id?: string; x?: number; y?: number; width?: number; height?: number; start?: { id?: string }; end?: { id?: string } };

const SHAPES = new Set(["rectangle", "ellipse", "diamond"]);

// Claude writes simple "skeleton" elements (boxes with labels, arrows between ids).
// Fill in what Excalidraw needs so a sketch never fails over a missing number.
function normalize(items: Skeleton[]): Skeleton[] {
  const byId = new Map<string, Skeleton>();
  const out = items.map((e, i) => {
    const el: Skeleton = { ...e };
    if (SHAPES.has(el.type ?? "")) {
      el.x ??= (i % 4) * 220;
      el.y ??= Math.floor(i / 4) * 160;
      el.width ??= 180;
      el.height ??= 80;
    }
    if (el.id) byId.set(el.id, el);
    return el;
  });
  for (const el of out) {
    if (el.type !== "arrow" && el.type !== "line") continue;
    const a = el.start?.id ? byId.get(el.start.id) : undefined;
    const b = el.end?.id ? byId.get(el.end.id) : undefined;
    if (a && b && el.x === undefined) {
      // Edge to edge (not center to center), so the arrow and its label sit in the gap.
      const [ax, ay, aw, ah] = [a.x!, a.y!, a.width!, a.height!];
      const [bx, by, bw, bh] = [b.x!, b.y!, b.width!, b.height!];
      const dx = bx + bw / 2 - (ax + aw / 2), dy = by + bh / 2 - (ay + ah / 2);
      const across = Math.abs(dx) >= Math.abs(dy);
      const start = across ? [dx > 0 ? ax + aw : ax, ay + ah / 2] : [ax + aw / 2, dy > 0 ? ay + ah : ay];
      const end = across ? [dx > 0 ? bx : bx + bw, by + bh / 2] : [bx + bw / 2, dy > 0 ? by : by + bh];
      el.x = start[0];
      el.y = start[1];
      el.width = end[0] - start[0];
      el.height = end[1] - start[1];
    }
    el.x ??= 0;
    el.y ??= 0;
  }
  return out;
}

// Turns what Claude wrote into Excalidraw elements: a skeleton list, { elements },
// or a full .excalidraw file.
export async function toElements(source: string): Promise<Elements> {
  const data = JSON.parse(source);
  const list: Skeleton[] = Array.isArray(data) ? data : Array.isArray(data?.elements) ? data.elements : [];
  if (!list.length) throw new Error("No elements.");
  const { convertToExcalidrawElements } = await import("@excalidraw/excalidraw");
  // Already full elements (from a saved .excalidraw file): use as they are.
  if (list.every((e) => "seed" in e && "version" in e)) return list as unknown as Elements;
  return convertToExcalidrawElements(normalize(list) as never, { regenerateIds: false }) as unknown as Elements;
}

export async function mermaidToElements(code: string): Promise<Elements> {
  const [{ parseMermaidToExcalidraw }, { convertToExcalidrawElements }] = await Promise.all([
    import("@excalidraw/mermaid-to-excalidraw"),
    import("@excalidraw/excalidraw"),
  ]);
  const { elements } = await parseMermaidToExcalidraw(code, { themeVariables: { fontSize: "16px" } });
  return convertToExcalidrawElements(elements as never) as unknown as Elements;
}

function download(name: string, blob: Blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

type Api = {
  getSceneElements: () => readonly unknown[];
  getAppState: () => Record<string, unknown>;
  getFiles: () => Record<string, unknown>;
  scrollToContent: (target?: unknown, opts?: { fitToContent?: boolean; animate?: boolean }) => void;
  updateScene: (scene: { elements: unknown }) => void;
};

// Once Excalidraw's hand-drawn font has loaded, re-measure the text (it was
// measured with a fallback font, which clips labels), then zoom to fit.
// Returns nothing on purpose: React 19 treats a ref callback's return value as
// its cleanup function.
const settle = (a: Api): void => {
  void (async () => {
    await new Promise((r) => setTimeout(r, 80)); // let Excalidraw register its fonts
    await document.fonts.ready;
    const { restoreElements } = await import("@excalidraw/excalidraw");
    a.updateScene({ elements: restoreElements(a.getSceneElements() as never, null, { refreshDimensions: true, repairBindings: true }) });
    a.scrollToContent(undefined, { fitToContent: true, animate: false });
  })();
};

// Full-screen board you can draw on. Start it from a whiteboard block or a Mermaid diagram.
export function WhiteboardModal({ elements, title, onClose }: { elements: Elements; title: string; onClose: () => void }) {
  const theme = useTheme();
  const [api, setApi] = useState<Api | null>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".excalidraw .Island:focus-within") && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  const exportPng = async () => {
    if (!api) return;
    const { exportToBlob } = await import("@excalidraw/excalidraw");
    const blob = await exportToBlob({ elements: api.getSceneElements() as never, appState: { ...api.getAppState(), exportBackground: true } as never, files: api.getFiles() as never, mimeType: "image/png" });
    download(`${title}.png`, blob);
  };
  const exportFile = async () => {
    if (!api) return;
    const { serializeAsJSON } = await import("@excalidraw/excalidraw");
    const json = serializeAsJSON(api.getSceneElements() as never, api.getAppState() as never, api.getFiles() as never, "local");
    download(`${title}.excalidraw`, new Blob([json], { type: "application/json" }));
  };
  const btn = "inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs hover:border-accent hover:text-accent disabled:opacity-50";

  return createPortal(
    <div className="fixed inset-0 z-[200] flex flex-col bg-bg">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <PenLine size={15} className="text-accent" />
        <span className="flex-1 truncate text-sm font-medium">{title}</span>
        <button className={btn} disabled={!api} onClick={exportPng}>
          <ImageDown size={12} /> PNG
        </button>
        <button className={btn} disabled={!api} onClick={exportFile} title="Save as an .excalidraw file you can open at excalidraw.com">
          <Download size={12} /> .excalidraw
        </button>
        <button className="rounded-full p-1.5 text-muted hover:bg-sunken hover:text-ink" onClick={onClose} aria-label="Close whiteboard">
          <X size={16} />
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <Excalidraw
          initialData={{ elements: elements as never, appState: { viewBackgroundColor: "#ffffff" }, scrollToContent: true }}
          theme={theme}
          excalidrawAPI={(a) => {
            setApi(a as unknown as Api);
            settle(a as unknown as Api);
          }}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
        />
      </div>
    </div>,
    document.body,
  );
}

// A ```excalidraw block in a reply: a small read-only sketch, with a button to open it as a full board.
export function WhiteboardBlock({ code }: { code: string }) {
  const theme = useTheme();
  const [elements, setElements] = useState<Elements | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [board, setBoard] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Wait for the stream to pause; mid-reply the JSON is usually unfinished.
    const t = setTimeout(() => {
      toElements(code).then(
        (els) => {
          setElements(els);
          setInvalid(false);
        },
        () => setInvalid(true),
      );
    }, 300);
    return () => clearTimeout(t);
  }, [code]);

  const btn = "rounded-md p-1 text-muted hover:bg-sunken hover:text-ink disabled:opacity-40";
  return (
    <div className="not-prose overflow-hidden rounded-xl border border-line bg-panel" data-no-select>
      <div className="flex items-center gap-1 border-b border-line px-2 py-1 text-[0.7rem] text-muted">
        <PenLine size={12} className="text-accent" />
        <span className="mr-auto">{elements ? "Whiteboard" : invalid ? "Whiteboard (drawing…)" : "Whiteboard"}</span>
        <button
          className={btn}
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          title="Copy the sketch's JSON"
          aria-label="Copy whiteboard JSON"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        <button onClick={() => setBoard(true)} disabled={!elements} className="ml-1 inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 hover:border-accent hover:text-accent disabled:opacity-40">
          <PenLine size={11} /> Open board
        </button>
      </div>
      {elements ? (
        <div className="lens-wb-inline relative h-[360px]">
          <Excalidraw
            key={theme}
            initialData={{ elements: elements as never, appState: { viewBackgroundColor: "#ffffff" }, scrollToContent: true }}
            theme={theme}
            viewModeEnabled
            zenModeEnabled
            excalidrawAPI={(a) => settle(a as unknown as Api)}
            UIOptions={{ canvasActions: { changeViewBackgroundColor: false, clearCanvas: false, export: false, loadScene: false, saveAsImage: false, saveToActiveFile: false, toggleTheme: false } }}
          />
        </div>
      ) : (
        <pre className="!m-0 max-h-60 overflow-auto !rounded-none text-xs">
          <code>{code}</code>
        </pre>
      )}
      {board && elements && <WhiteboardModal elements={elements} title="Whiteboard" onClose={() => setBoard(false)} />}
    </div>
  );
}
