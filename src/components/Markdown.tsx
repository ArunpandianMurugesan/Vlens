"use client";

import { isValidElement, memo, type ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLensSettings } from "./LensSettings";
import { MermaidBlock } from "./Mermaid";

export const Markdown = memo(function Markdown({ text, className = "" }: { text: string; className?: string }) {
  const settings = useLensSettings();
  const diagrams = settings?.showDiagrams !== false;
  return (
    <div className={`md ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (p) => <a {...p} target="_blank" rel="noreferrer" />,
          // ```mermaid blocks become diagrams (unless turned off in Settings).
          pre: ({ children, className }) => {
            const child = (Array.isArray(children) ? children[0] : children) as ReactElement<{ className?: string; children?: unknown }>;
            if (diagrams && isValidElement(child) && /\blanguage-mermaid\b/.test(child.props.className ?? ""))
              return <MermaidBlock code={String(child.props.children ?? "").replace(/\n$/, "")} />;
            return <pre className={className}>{children}</pre>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
