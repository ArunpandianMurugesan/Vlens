// Models you can pick in Vlens. "" means "whatever the CLI would use".
// Aliases always point at the latest model of that family.
export const MODELS = [
  { id: "", label: "CLI default" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
  { id: "fable", label: "Fable" },
] as const;

const ALIASES = new Set<string>(MODELS.map((m) => m.id));

// An alias above or a full model name like "claude-opus-5-5" (optionally "[1m]").
export function isModel(m: unknown): m is string {
  return typeof m === "string" && (ALIASES.has(m) || /^claude-[a-z0-9-]+(\[1m\])?$/.test(m));
}

export const modelArgs = (m: string | undefined | null) => (m ? ["--model", m] : []);
