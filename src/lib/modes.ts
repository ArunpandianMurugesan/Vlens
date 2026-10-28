// The CLI's permission modes, worded like the terminal (Shift+Tab cycles them there too).
export type PermissionMode = "default" | "acceptEdits" | "plan" | "auto" | "bypassPermissions";

export const PERMISSION_MODES: { id: PermissionMode; label: string; hint: string }[] = [
  { id: "default", label: "Ask before edits", hint: "Asks before editing files or running commands that need approval" },
  { id: "acceptEdits", label: "Accept edits", hint: "Edits files without asking; still asks for risky commands" },
  { id: "plan", label: "Plan mode", hint: "Read-only: Claude looks around and writes a plan for you to approve" },
  { id: "auto", label: "Auto mode", hint: "A safety check approves routine steps and only asks about risky ones" },
  { id: "bypassPermissions", label: "Bypass permissions", hint: "Never asks. Claude can run anything, so use it only in folders you trust" },
];

export const isPermissionMode = (m: unknown): m is PermissionMode => PERMISSION_MODES.some((p) => p.id === m);
