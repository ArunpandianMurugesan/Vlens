// Shared types between the API routes and the UI.

export type Block =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; text: string; isError: boolean }
  | { kind: "image"; src?: string }; // src: a URL or data: URL to show it


export interface ChatMessage {
  id: string;
  parentId: string | null;
  role: "user" | "assistant" | "sub-agent";
  blocks: Block[];
  timestamp: string;
}

export interface SessionSummary {
  id: string;
  projectDir: string;
  projectName: string;
  cwd: string | null;
  title: string;
  updatedAt: string;
  messageCount: number;
  active?: ActiveInfo; // set while a Claude Code process has this session open
  pinOrder?: number; // set when pinned: position in pin order
  recentAt?: string; // when Lens last started or replied in it (within the Recent window)
  context?: ContextUsage;
}

// How full the session's context window was at its last reply.
export interface ContextUsage {
  used: number; // tokens
  window: number; // the model's context window, in tokens
  estimated: boolean; // true until a run has told us this model's window size
  model: string | null;
}

export interface LimitWindow {
  utilization: number; // 0..1
  resetsAt: number; // unix seconds
  status: string; // "allowed", or a limited state
}

export interface Limits {
  windows: { fiveHour: LimitWindow | null; sevenDay: LimitWindow | null } | null;
  updatedAt: string | null;
  contextWindows: Record<string, number>; // model -> context window size
  commands?: Record<string, string[]>; // folder -> slash commands the CLI offered there
}

export interface SlashCommand {
  name: string;
  description: string;
  kind: "skill" | "command";
}

export interface ActiveInfo {
  status: "busy" | "idle"; // busy = working on a reply
  entrypoint: "cli" | "desktop";
  startedAt: number; // when the process started; gives the sidebar a stable order
}

export interface SessionDetail extends SessionSummary {
  messages: ChatMessage[];
}

// A sub-thread is a nested conversation spawned from a snippet of a message.
// The parent is either a root session message or a message in another sub-thread,
// so threads form a tree.
export interface SubThread {
  id: string;
  rootSessionId: string;
  parentThreadId: string | null; // null = spawned from the root session
  anchorMessageId: string; // message the snippet was selected from
  selectedContextText: string;
  cwd: string | null;
  claudeSessionId: string | null; // CLI session used for `--resume` on follow-ups
  messages: ChatMessage[];
  createdAt: string;
}

// Events streamed from /api/agent to the browser (newline-delimited JSON).
export type AgentEvent =
  | { type: "thread"; thread: SubThread }
  | { type: "session"; claudeSessionId: string }
  | { type: "delta"; text: string }
  | { type: "tool"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; text: string; isError: boolean }
  | { type: "done"; message: ChatMessage }
  | { type: "error"; error: string };

export interface Settings {
  defaultModel: string; // "" = CLI default; used for replies and new sessions from Lens
  subAgentModel: string; // "" = same as defaultModel
  autoRestore: boolean; // reopen crashed sessions without asking
  terminalApp: "Terminal" | "iTerm"; // where restored sessions open
  showDiagrams: boolean; // draw ```mermaid blocks as diagrams
  animateDiagrams: boolean; // animate every arrow, not just the ones marked animate
  diagramSkill: boolean; // load the built-in lens:diagrams skill into Lens runs
}

// A CLI session whose process stopped without closing normally (crash, reboot).
export interface CrashedSession {
  key: string;
  sessionId: string;
  title: string;
  cwd: string;
  stoppedAt: string;
}

export interface Account {
  loggedIn: boolean;
  email: string | null;
  orgName: string | null;
  plan: string | null; // e.g. "pro", "max", "team"
  method: string | null; // e.g. "claude.ai", "apiKey"
}

export interface McpServer {
  name: string; // connectors are named "claude.ai <Name>"
  target: string; // URL or command
  transport: "stdio" | "http" | "sse";
  status: "connected" | "needs-auth" | "pending" | "failed";
  statusText: string;
  kind: "server" | "connector"; // connector = added on claude.ai, managed there
  scope?: "user" | "local";
  project?: string; // folder, for local scope
}

export interface Skill {
  name: string; // plugin skills are "plugin:skill"
  description: string;
  source: "user" | "project" | "synced" | "plugin";
  enabled: boolean;
  editable: boolean; // false for synced and plugin skills
  path: string; // the skill's folder
  project?: string; // for project skills
  plugin?: string;
}

// An image attached to a message (base64, no data: prefix).
export interface ImageInput {
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  data: string;
}

export type HookScope = "user" | "project" | "local";

export interface HookEntry {
  id: string; // stable for this exact hook; changes if the hook is edited elsewhere
  scope: HookScope | "plugin";
  file: string; // the settings (or plugin hooks.json) file it lives in
  event: string; // e.g. "PreToolUse"
  matcher?: string; // e.g. "Bash" or "Write|Edit"
  hook: { type: string; command?: string; prompt?: string; url?: string; timeout?: number; [k: string]: unknown };
  enabled: boolean;
  managedBy?: string; // another app that installed it, e.g. "my-tool"
  plugin?: string;
}

// ── Lens Review ──

// Whose move it is on a PR.
export type PrLane = "needsYou" | "mine" | "team" | "waiting" | "done" | "fyi";

export interface PrSummary {
  url: string;
  repo: string; // owner/name
  number: number;
  title: string;
  author: string;
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  head: string;
  base: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  labels: string[];
  ci: "passing" | "failing" | "pending" | "none";
  mergeable: string; // MERGEABLE | CONFLICTING | UNKNOWN
  reviewDecision: string | null; // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
  approvals: number;
  requiredApprovals: number | null; // null when the branch has no rule (or we can't see it)
  myReview: string | null;
  changedSinceMyReview: boolean;
  lane: PrLane;
  why: string;
}

export interface ReviewBoard {
  login: string | null;
  prs: PrSummary[];
  fetchedAt: string | null;
  clones: Record<string, string>; // "owner/name" (lowercase) -> local folder
  home?: string; // your home folder, for showing paths as ~/…
  error?: string;
}

export interface PrDetail {
  body: string;
  files: { path: string; additions: number; deletions: number }[];
  reviews: { author: string; state: string; body: string; at: string }[];
  checks: { name: string; state: string; url: string | null }[];
  comments: number;
  mergeState: string | null;
}
