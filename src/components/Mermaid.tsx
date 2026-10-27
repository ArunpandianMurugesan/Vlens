"use client";

import { Check, Code2, Copy, Loader2, Maximize2, Network, PenLine, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/lib/theme";
import { useLensSettings } from "./LensSettings";
import { mermaidToElements, WhiteboardModal } from "./Whiteboard";

type MermaidApi = typeof import("mermaid").default;

// Mermaid is big, so load it the first time a diagram shows up.
let loading: Promise<MermaidApi> | null = null;
const loadMermaid = () => (loading ??= import("mermaid").then((m) => m.default));

// Renders a ```mermaid block. While a reply is still streaming the code is
// often incomplete; then we keep showing the code until it parses.
export function MermaidBlock({ code }: { code: string }) {
  const settings = useLensSettings();
  const dark = useTheme() === "dark"; // follows the theme chosen in Lens
  const rawId = useId();
  const id = `mmd-${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [full, setFull] = useState(false);
  const [copied, setCopied] = useState(false);
  // "Open on whiteboard": the same diagram as editable hand-drawn shapes.
  const [board, setBoard] = useState<readonly unknown[] | null>(null);
  const [toBoard, setToBoard] = useState<"idle" | "busy" | "failed">("idle");
  const openBoard = async () => {
    setToBoard("busy");
    try {
      setBoard(await mermaidToElements(code));
      setToBoard("idle");
    } catch {
      setToBoard("failed"); // not every Mermaid diagram type converts (flowcharts and sequences do)
    }
  };
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    // Wait for the stream to pause, so we don't re-draw on every token.
    const t = setTimeout(async () => {
      const mermaid = await loadMermaid();
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict", // no scripts or click handlers from diagram code
        theme: dark ? "dark" : "neutral",
        fontFamily: "var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif",
        suppressErrorRendering: true,
        flowchart: { curve: "basis", htmlLabels: true },
      });
      try {
        if (!(await mermaid.parse(code, { suppressErrors: true }))) throw new Error("invalid");
        const { svg } = await mermaid.render(`${id}-${mine}`, code);
        if (mine === seq.current) {
          setSvg(svg);
          setInvalid(false);
        }
      } catch {
        if (mine === seq.current) setInvalid(true);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [code, dark, id]);

  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [full]);

  const animate = settings?.animateDiagrams ? " animate-all" : "";
  const codeView = (
    <pre className="!m-0 !rounded-none">
      <code>{code}</code>
    </pre>
  );
  const btn = "rounded-md p-1 text-muted hover:bg-sunken hover:text-ink";

  return (
    <div className="lens-diagram-wrap not-prose overflow-hidden rounded-xl border border-line bg-panel" data-no-select>
      <div className="flex items-center gap-1 border-b border-line px-2 py-1 text-[0.7rem] text-muted">
        <Network size={12} className="text-accent" />
        <span className="mr-auto">{invalid && !svg ? "Diagram (drawing…)" : "Diagram"}</span>
        <button className={btn} onClick={() => setShowCode((c) => !c)} title={showCode ? "Show diagram" : "Show code"} aria-label="Toggle code">
          <Code2 size={13} />
        </button>
        <button
          className={btn}
          onClick={() => {
            void navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          title="Copy Mermaid code"
          aria-label="Copy Mermaid code"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
        {settings?.showWhiteboards !== false && (
          <button className={btn} onClick={openBoard} disabled={!svg || toBoard === "busy"} title={toBoard === "failed" ? "This kind of diagram can't open on the whiteboard" : "Open on whiteboard (edit and sketch on it)"} aria-label="Open on whiteboard">
            {toBoard === "busy" ? <Loader2 size={13} className="animate-spin" /> : <PenLine size={13} className={toBoard === "failed" ? "opacity-40" : ""} />}
          </button>
        )}
        <button className={btn} onClick={() => setFull(true)} disabled={!svg} title="Full screen" aria-label="Full screen">
          <Maximize2 size={13} />
        </button>
      </div>
      {showCode || !svg ? (
        <div>
          {codeView}
          {invalid && svg === null && <p className="px-3 py-1.5 text-[0.7rem] text-muted">Can&apos;t draw this yet. If the reply has finished, the diagram has a syntax error.</p>}
        </div>
      ) : (
        // Mermaid's strict mode sanitizes the SVG it returns.
        <div className={`lens-diagram flex justify-center overflow-x-auto p-4${animate}`} dangerouslySetInnerHTML={{ __html: svg }} />
      )}

      {full &&
        svg &&
        createPortal(
          <div className="fixed inset-0 z-[200] flex flex-col bg-bg/95 backdrop-blur" onClick={() => setFull(false)}>
            <div className="flex justify-end p-3">
              <button className="rounded-full bg-panel p-2 shadow" aria-label="Close full screen" onClick={() => setFull(false)}>
                <X size={16} />
              </button>
            </div>
            <div
              className={`lens-diagram lens-diagram-full flex flex-1 items-center justify-center overflow-auto p-6${animate}`}
              onClick={(e) => e.stopPropagation()}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>,
          document.body,
        )}
      {board && <WhiteboardModal elements={board} title="Diagram" onClose={() => setBoard(null)} />}
    </div>
  );
}
