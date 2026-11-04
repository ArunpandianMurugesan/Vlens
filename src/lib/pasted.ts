// Long text you paste goes into your message as a <pasted-text> block, so the
// chat can show it as a card (like Claude or ChatGPT do) instead of a wall of
// text. Claude reads it as plain text with a light wrapper around it.

export const PASTE_LINES = 10;
export const PASTE_CHARS = 1000;

export const isLongPaste = (t: string) => t.length >= PASTE_CHARS || t.split("\n").length >= PASTE_LINES;

export const wrapPaste = (t: string) => `<pasted-text>\n${t}\n</pasted-text>`;

export type Segment = { kind: "text"; text: string } | { kind: "paste"; text: string };

// A message's text, split into what you typed and what you pasted.
export function splitPasted(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /<pasted-text>\n?([\s\S]*?)\n?<\/pasted-text>/g;
  let at = 0;
  for (let m: RegExpExecArray | null; (m = re.exec(text)); ) {
    const before = text.slice(at, m.index).trim();
    if (before) out.push({ kind: "text", text: before });
    out.push({ kind: "paste", text: m[1] });
    at = m.index + m[0].length;
  }
  const rest = text.slice(at).trim();
  if (rest) out.push({ kind: "text", text: rest });
  return out;
}

// For titles and previews: the pastes as "[Pasted text]".
export const withoutPastes = (text: string) => text.replace(/<pasted-text>[\s\S]*?<\/pasted-text>/g, "[Pasted text]").trim();

export const lineCount = (t: string) => t.split("\n").length;
