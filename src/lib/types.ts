import type { PermissionMode } from "./modes";
// Shared types between the API routes and the UI.

export type Block =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; text: string; isError: boolean }
  | { kind: "image"; src?: string } // src: a URL or data: URL to show it
  | { kind: "compact"; text: string }; // the summary the conversation was compacted into


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
  days?: Record<string, number>; // local date (YYYY-MM-DD) → messages that day, for the last few weeks (History)
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
  byLens?: boolean; // a `claude -p` run Lens itself started (not a terminal or the desktop app)
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
  | {
      // Claude wants to run something that needs your OK.
      type: "permission";
      id: string;
      tool: string;
      input: unknown;
      description: string | null;
      reason: string | null;
      always: string | null; // what "always allow" would save, when the CLI offers it
      questions?: Question[]; // set when Claude is asking you something (AskUserQuestion)
      plan?: string; // set when Claude wants to leave plan mode (ExitPlanMode)
    }
  | { type: "permission_done"; id: string; decision: "allow" | "always" | "deny"; mode?: PermissionMode } // mode: the plan was approved in this mode
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
  showWhiteboards: boolean; // draw ```excalidraw blocks as whiteboards
  whiteboardSkill: boolean; // load the built-in lens:whiteboard skill into Lens runs
  onboarded: boolean; // went through Get started once
  notifications: boolean; // desktop notifications when Claude needs you or finishes
  coach: boolean; // the Coach card on Home: "Fix this now" signals from your sessions
  retro: boolean; // Retro buttons: Claude reviews a session and suggests lessons
  lessonsToClaudeMd: boolean; // Apply writes lessons into a Lens block in CLAUDE.md
  lessonsTarget: "project" | "user"; // default for Apply: the repo's CLAUDE.md or ~/.claude/CLAUDE.md
  retroModel: string; // model for retros (a cheap one is plenty)
  cliMode?: PermissionMode; // read-only: the mode your terminal claude starts in (~/.claude/settings.json)
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

// ── Home dashboard ──

export interface DayStats {
  prompts: number; // messages you sent
  replies: number; // model calls
  toolCalls: number;
  tokensSent: number; // context sent with each reply, summed (what long sessions burn)
  tokensWritten: number; // tokens Claude wrote
}

export interface HeavySession {
  id: string;
  title: string;
  projectName: string;
  cwd: string | null;
  active: boolean;
  activeWhere: "cli" | "desktop" | null;
  used: number; // tokens sent with its latest reply
  window: number;
  estimated: boolean;
  replies: number;
  compactions: number;
  updatedAt: string;
}

export interface DashboardData {
  account: Account;
  limits: Limits;
  counts: { sessions: number; active: number; thisWeek: number; compactions: number };
  days: { date: string; stats: DayStats }[]; // last 14 days, oldest first
  heavy: HeavySession[];
  autoCompact: boolean; // the CLI compacts on its own when the window fills
}

// ── Marketplace ──

export interface Marketplace {
  name: string;
  source: string; // owner/repo, URL or path it was added from
  location: string | null; // local copy of its catalog
}

export interface MarketplacePlugin {
  id: string; // name@marketplace
  name: string;
  marketplace: string;
  description: string;
  version: string | null;
  installCount: number | null;
  installs: { scope: string; enabled: boolean; version: string | null; project: string | null }[];
}

export interface PluginDetail {
  id: string;
  inventory: string | null; // the CLI's `plugin details` text
  alwaysOnTokens: number | null; // added to every session's context
  skills: { name: string; description: string }[];
  readme: string | null;
}

// ── File viewer ──

export interface FileView {
  path: string; // absolute
  name: string;
  home: string; // to show paths as ~/…
  mtime: string | null;
  kind: "text" | "image" | "dir" | "binary" | "too-big" | "missing";
  size?: number;
  lang?: string;
  text?: string;
  lines?: number;
  html?: string; // highlighted, one .line per line with data-line="n"
  entries?: { name: string; dir: boolean }[];
}

// One question from Claude's AskUserQuestion tool.
export interface Question {
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multiSelect?: boolean;
}

// What Get started checks: the tools Lens runs, and who they're signed in as.
export interface SetupStatus {
  claude: { installed: boolean; version: string | null };
  account: Account;
  gh: { installed: boolean; user: string | null }; // optional: only Lens Review needs it
  onboarded: boolean;
}

// ── Coach ──

// Something in your recent sessions worth fixing, with a way to act on it.
export interface CoachSignal {
  id: string;
  kind: "rereads" | "errors" | "corrections" | "pastes" | "longlived";
  title: string;
  detail: string;
  sessionId?: string;
  sessionTitle?: string;
  cwd?: string | null;
  lesson?: string; // a suggested lesson to add, editable before saving
}

// What a retro of one session found.
export interface Retro {
  sessionId: string;
  title: string;
  cwd: string | null;
  at: string;
  wentWell: string[];
  mistakes: string[];
}

// A one-line lesson. Applied ones live in a Lens block in that CLAUDE.md.
export interface Lesson {
  id: string;
  text: string;
  cwd: string | null; // the project it came from
  sessionId?: string;
  createdAt: string;
  applied?: "project" | "user"; // which CLAUDE.md it's in, if any
}

export interface CoachData {
  signals: CoachSignal[];
  retros: Retro[];
  lessons: Lesson[];
}
