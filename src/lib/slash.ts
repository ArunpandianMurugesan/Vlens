// Slash commands that open a menu in the terminal. Vlens's Claude runs without
// a screen (`claude -p`), where these print their choices or say they "aren't
// available in this environment", so Vlens shows its own menus and screens
// for them (components/SlashPanel.tsx).

export type SlashUi =
  | "model" // Vlens's own model picker
  | "effort" // menus built from the CLI's usage text, sent as "/effort high"
  | "output-style"
  | "config"
  | "resume" // Vlens screens for commands the CLI doesn't run without a screen
  | "memory"
  | "status"
  | "mcp"
  | "hooks"
  | "permissions";

const UI = new Set<SlashUi>(["model", "effort", "output-style", "config", "resume", "memory", "status", "mcp", "hooks", "permissions"]);

// "/model" alone opens the menu; "/model opus" goes straight to Claude.
export function slashUi(text: string): SlashUi | null {
  const m = /^\/([a-z][\w-]*)\s*$/.exec(text.trim());
  return m && UI.has(m[1] as SlashUi) ? (m[1] as SlashUi) : null;
}

export interface Choice {
  value: string;
  label: string;
  hint?: string;
  current?: boolean;
}

// "Usage: /effort <low|medium|high|xhigh|max|auto|ultracode [on|off]>"
export function effortChoices(text: string): Choice[] {
  const inner = /<([^>]*)>/.exec(text)?.[1] ?? "";
  return inner
    .split("|")
    .filter((v) => /^[a-z]+$/.test(v))
    .map((v) => ({ value: v, label: v }));
}

// "- Concise: Claude responds tersely…", "- default (current)"
export function styleChoices(text: string): Choice[] {
  const out: Choice[] = [];
  for (const line of text.split("\n")) {
    const m = /^- ([^:]+?)( \(current\))?(?::\s*(.*))?$/.exec(line.trim());
    if (m) out.push({ value: m[1], label: m[1], hint: m[3], current: !!m[2] });
  }
  return out;
}

// "  theme=auto|dark|light", "  language=<value>"
export function configChoices(text: string): { key: string; options: string[] | null }[] {
  const out: { key: string; options: string[] | null }[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s+([A-Za-z]\w*)=(.+)$/.exec(line);
    if (m) out.push({ key: m[1], options: m[2].trim() === "<value>" ? null : m[2].split("|") });
  }
  return out;
}

// "/x isn't available in this environment." — Claude's reply to a command it
// can only run in the terminal.
export const unavailableCommand = (text: string) => /^\/([\w:-]+) isn't available in this environment\.?$/.exec(text.trim())?.[1] ?? null;
