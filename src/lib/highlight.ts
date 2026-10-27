"use client";

import { type RefObject, useEffect } from "react";

// Marks snippets that spawned a sub-thread using the CSS Custom Highlight API,
// so we can paint over rendered markdown without changing its DOM.

type Name = "subthread" | "subthread-active";

function registry(name: Name): Highlight | null {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return null;
  let h = CSS.highlights.get(name);
  if (!h) {
    h = new Highlight();
    CSS.highlights.set(name, h);
  }
  return h;
}

// Find `snippet` in the element's text, ignoring whitespace differences
// (a browser selection across paragraphs adds newlines the DOM text doesn't have).
function findRange(root: HTMLElement, snippet: string): Range | null {
  const chars: { node: Text; offset: number }[] = [];
  let flat = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    const v = n.nodeValue ?? "";
    for (let i = 0; i < v.length; i++) {
      if (/\s/.test(v[i])) continue;
      chars.push({ node: n, offset: i });
      flat += v[i];
    }
  }
  const needle = snippet.replace(/\s+/g, "");
  if (!needle) return null;
  const at = flat.indexOf(needle);
  if (at < 0) return null;
  const start = chars[at];
  const end = chars[at + needle.length - 1];
  const r = document.createRange();
  r.setStart(start.node, start.offset);
  r.setEnd(end.node, end.offset + 1);
  return r;
}

export function useSnippetHighlights(
  ref: RefObject<HTMLElement | null>,
  items: { text: string; active: boolean }[],
  contentKey: string,
) {
  const key = JSON.stringify(items);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const added: [Highlight, Range][] = [];
    for (const it of items) {
      const h = registry(it.active ? "subthread-active" : "subthread");
      const r = h && findRange(el, it.text);
      if (h && r) {
        h.add(r);
        added.push([h, r]);
      }
    }
    return () => added.forEach(([h, r]) => h.delete(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, contentKey]);
}
