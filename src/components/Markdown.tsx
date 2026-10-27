"use client";

import { isValidElement, memo, type ReactElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCwd, useFiles } from "./FileContext";
import { useLensSettings } from "./LensSettings";
import { MermaidBlock } from "./Mermaid";
import { WhiteboardBlock } from "./Whiteboard";

// Looks like a file path: has a folder part and an extension, maybe ":42" after it.
// "src/app.ts", "~/notes/plan.md", "/Users/me/x.py:12", "./a/b.json".
const PATH = /^(~\/|\/|\.{1,2}\/)?([\w@.+-]+\/)+[\w@+-][\w.@+-]*\.[A-Za-z0-9]{1,8}(:\d+(-\d+)?)?$/;

// A link target that's a file on this Mac rather than a web page.
function localHref(href: string | undefined): string | null {
  if (!href) return null;
  if (href.startsWith("file://")) return href.slice(7);
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return null; // http:, mailto:, anchors
  return PATH.test(decodeURI(href)) || href.startsWith("/") || href.startsWith("~/") ? decodeURI(href) : null;
}

function FileLink({ path, children, code }: { path: string; children: ReactNode; code?: boolean }) {
  const files = useFiles();
  const cwd = useCwd();
  if (!files) return code ? <code>{children}</code> : <span>{children}</span>;
  return (
    <button
      type="button"
      onClick={() => files.open(path, { cwd })}
      title={`Open ${path}`}
      className={code ? "lens-file-code" : "lens-file-link"}
    >
      {code ? <code>{children}</code> : children}
    </button>
  );
}

export const Markdown = memo(function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const settings = useLensSettings();
  const diagrams = settings?.showDiagrams !== false;
  const whiteboards = settings?.showWhiteboards !== false;
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Local file links open in the file panel; web links in your browser.
          a: ({ href, children }) => {
            const local = localHref(href);
            if (local) return <FileLink path={local}>{children}</FileLink>;
            return (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            );
          },
          // `path/to/file.ts` in a sentence opens the file too.
          code: ({ className: cls, children }) => {
            const t = String(children ?? "");
            if (!cls && !t.includes("\n") && PATH.test(t.trim())) return <FileLink path={t.trim()} code>{children}</FileLink>;
            return <code className={cls}>{children}</code>;
          },
          // ```mermaid blocks become diagrams and ```excalidraw blocks whiteboards (each can be turned off in Settings).
          pre: ({ children, className }) => {
            const child = (Array.isArray(children) ? children[0] : children) as ReactElement<{ className?: string; children?: unknown }>;
            const lang = isValidElement(child) ? (child.props.className ?? "") : "";
            const code = () => String(child.props.children ?? "").replace(/\n$/, "");
            if (diagrams && /\blanguage-mermaid\b/.test(lang)) return <MermaidBlock code={code()} />;
            // ```excalidraw blocks become hand-drawn whiteboard sketches.
            if (whiteboards && /\blanguage-excalidraw\b/.test(lang)) return <WhiteboardBlock code={code()} />;
            return <pre className={className}>{children}</pre>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
