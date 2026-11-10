import type { PermissionMode } from "./modes";
// Shared types between the API routes and the UI.

export type Block =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; text: string; isError: boolean }
  | { kind: "image"; src?: string } // src: a URL or data: URL to show it
  | { kind: "compact"; text: string } // the summary the conversation was compacted into
  | { kind: "notice"; text: string }; // a background agent or command reported back


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
  recentAt?: string; // when Vlens last started or replied in it (within the Recent window)
  archivedAt?: string; // set when you archived it (lib/archive.ts)
  botId?: string; // a chat with one of your bots (lib/bots.ts), shown in Bots, not in the sidebar
  days?: Record<string, number>; // local date (YYYY-MM-DD) → messages that day, for the last few weeks (History)
  context?: ContextUsage;
  forkedFrom?: string; // the session this one was forked from (shown nested under it)
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
  waitingFor?: string; // set while it needs you: "input needed", "dialog open", …
  entrypoint: "cli" | "desktop";
  startedAt: number; // when the process started; gives the sidebar a stable order
  byLens?: boolean; // a `claude -p` run Vlens itself started (not a terminal or the desktop app)
}

export interface SessionDetail extends SessionSummary {
  messages: ChatMessage[];
  branch?: string | null; // its git branch, from the session file
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
// A sub-agent or background command Claude started, as the CLI reports it.
export interface TaskInfo {
  id: string;
  toolUseId: string | null; // the Agent / Bash call that started it
  parentId: string | null; // set when another task started this one
  kind: string; // "local_agent", "local_bash", …
  agentType: string | null; // e.g. "general-purpose", "Explore"
  description: string;
  background: boolean;
  status: "running" | "completed" | "failed" | "killed";
  lastTool: string | null;
  activity: string | null; // what it's doing now, e.g. "Reading a.txt"
  toolUses: number;
  tokens: number;
  startedAt: number;
  ms: number;
}

// What Claude is doing right now in the main conversation.
export type RunStatus = { kind: "requesting" | "thinking" | "writing" } | { kind: "tool"; tool: string };

export type AgentEvent =
  | { type: "thread"; thread: SubThread }
  | { type: "status"; status: RunStatus }
  | { type: "task"; task: TaskInfo }
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
      preview?: string; // a bot's setup change, line breaks kept (botAgent.ts)
    }
  | { type: "permission_done"; id: string; decision: "allow" | "always" | "deny"; mode?: PermissionMode } // mode: the plan was approved in this mode
  | { type: "done"; message: ChatMessage }
  | { type: "error"; error: string };

// A session's Claude process outside of any reply you're waiting on: Claude
// working on its own after a background task reported back, the background
// work still running, and questions it's waiting on you for.
export interface LiveState {
  busy: boolean;
  status: RunStatus | null;
  tasks: TaskInfo[];
  asks: Extract<AgentEvent, { type: "permission" }>[];
}

// A bot you set up in Vlens (lib/bots.ts).
export interface Bot {
  id: string;
  name: string;
  avatar: string; // a letter or emoji
  about: string; // one line, shown in the list
  role: string; // its instructions (goes into its CLAUDE.md)
  mode: string; // permission mode for its chats; "" = the same as your Claude Code (its defaultMode)
  model: string; // "" = CLI default
  mcp: string[]; // the MCP servers it may use; every other one is off for it
  style: string; // how it writes (its output style)
  sources: { sessionFolders: string[] }; // what "Digest" learns from
  // May it read your Claude sessions (terminal, desktop, Vlens) and their memory files? Only you set this.
  sessionAccess?: { all: boolean; folders: string[] };
  // Only you set these (its Settings), never the bot:
  allowTools?: string[]; // tools and commands it runs without asking, as Claude Code allow rules ("Bash(gh pr diff:*)")
  askTools?: string[]; // ones that always ask you first, whatever its mode (posting, pushing…)
  denyTools?: string[]; // ones it may never use (its "What it may do": Never)
  autoSaveIssues?: boolean; // save its issue notes without asking (drafts, status); publishing still asks
  watch?: BotWatch; // older single trigger; read as triggers[0] (lib/botWatch.ts)
  triggers?: BotTrigger[]; // what wakes it up (its Settings, Triggers)
  effort?: "" | "low" | "medium" | "high" | "xhigh" | "max"; // "" = the model's default
  knowledge?: { confluence: { id: string; title: string }[] }; // pages it reads fresh at the start of each chat
  skills?: string[] | null; // the skills it may use; null = all of yours
  plugins?: Record<string, boolean>; // plugin id -> on/off for this bot; unset = as in your Claude Code
  hooks?: BotHook[]; // scripts Claude Code runs at a hook event (only you add these)
  brain?: "off" | "read" | "remember"; // the Vlens brain (lib/brain): off, read only, or read and remember
  brainFolders?: string[]; // only memories from these folders (plus general ones); none = every folder
  brainLearn?: { all: boolean; folders: string[] }; // the brain learns from these Claude sessions for it (needs "remember"); unset = it doesn't ask the brain to learn
  limits?: { quietHours?: string; weekdaysOnly?: boolean; maxRunsPerDay?: number }; // when its triggers stay asleep (lib/botTriggers.ts)
  paused?: boolean; // its triggers don't run until you resume it (its page)
  job?: { when: string; think: string; act: string; updatedAt: string }; // its job in its own words (it writes this with set_job)
  notify: { digestDone: boolean; digestFailed: boolean; needsYou?: boolean; finished?: boolean; failed?: boolean; mac?: boolean };
  rules: { allowed: string[]; lookAt: string[]; dontLookAt: string[] }; // set in its setup (see lib/bots.ts)
  cursor: { sessions?: string }; // how far the last digest got
  lastDigest?: { at: string; ok: boolean; summary: string };
  createdAt: string;
  dir: string; // its folder
  notes?: number; // how many concepts its knowledge has (in lists)
  automation?: boolean; // its bot.yaml triggers run on their own while Vlens is open
  specTriggers?: { id: string; title: string; on: string; run: string; output: string }[]; // from an older bot.yaml (in lists)
  specError?: string; // what's wrong with its bot.yaml or values.yaml (in lists)
}


// What wakes a bot up (lib/botWatch.ts). No AI until something is worth working on:
//   schedule  every N minutes, `list` (a command) prints items as JSON {key, title, url?, version?, kind?}
//   session   one of your Claude sessions in `folders` started, ended or went idle; `match`
//             (a regex) must be found in its title or recent text, and its first match is the card's key
// For each new or changed item, `gate` (optional command) decides: exit 10 skips it,
// 75 tries again next check, 0 goes on with its output added to the brief.
export interface BotTrigger {
  id: string;
  name: string;
  on: boolean;
  kind: "schedule" | "session";
  everyMinutes: number;
  list: string;
  gate: string;
  event: "ended" | "started" | "idle";
  idleMinutes: number;
  folders: string[];
  match: string;
  brief: string; // {key} {title} {url} {version} {kind} {session} {folder}
  updateBrief: string;
  maxNew: number;
  source?: string; // where it looks (lib/botTriggers.ts): github.review_requested, time, command…; none = command / session
  params?: Record<string, string>; // the source's settings: repos, jql, at, days, agent
  playbook?: string; // the part of its playbook (a "## …" heading) this trigger follows
}

export interface BotHook {
  id: string;
  on: boolean;
  event: string; // PreToolUse, PostToolUse, Stop…
  matcher: string; // tool name pattern, like Bash or mcp__github__.*
  command: string;
}

// A bot's automation (lib/botWatch.ts): every `everyMinutes`, run `command` (no AI;
// it prints items as JSON, one per line or an array: {key, title, url?, version?, kind?}).
// A new item opens a card with `brief`; a changed `version` sends `updateBrief` to its card.
// In the briefs, {key} {title} {url} {version} {kind} are filled in.
export interface BotWatch {
  on: boolean;
  everyMinutes: number;
  command: string;
  brief: string;
  updateBrief: string;
  maxNew: number; // at most this many new cards per check
}

// One line in the bell at the top right: a bot telling you something.
export interface BotNotification {
  id: string;
  bot: string;
  botName: string;
  avatar: string;
  at: string;
  title: string;
  body: string;
  target?: { kind: "item" | "issue"; key: string }; // what it's about (an issue: its card); none: the bot itself
  read: boolean;
}

// Something a bot's trigger produced for you (everything but PR reviews).
export interface InboxItem {
  key: string;
  trigger: string; // its bot.yaml trigger id
  triggerTitle: string;
  kind: "draft" | "notes" | "notify"; // draft: a text for you; notes: written into its knowledge; notify: just news
  title: string;
  url?: string;
  context: string; // what the playbook was given
  version: string;
  status: "asked" | "running" | "ready" | "done" | "skipped" | "error";
  output?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}




// One concept file in a bot's knowledge (OKF).
export interface BotConcept {
  path: string; // inside knowledge/, e.g. "decisions/kb-batching.md"
  title: string;
  type: string | null;
  updated: string;
  size: number;
}

export interface Settings {
  defaultModel: string; // "" = CLI default; used for replies and new sessions from Vlens
  subAgentModel: string; // "" = same as defaultModel
  autoRestore: boolean; // reopen crashed sessions without asking
  terminalApp: "Terminal" | "iTerm"; // where restored sessions open
  showDiagrams: boolean; // draw ```mermaid blocks as diagrams
  animateDiagrams: boolean; // animate every arrow, not just the ones marked animate
  diagramSkill: boolean; // load the built-in lens:diagrams skill into Vlens runs
  showWhiteboards: boolean; // draw ```excalidraw blocks as whiteboards
  whiteboardSkill: boolean; // load the built-in lens:whiteboard skill into Vlens runs
  onboarded: boolean; // went through Get started once
  notifications: boolean; // desktop notifications when Claude needs you or finishes
  cliMode?: PermissionMode; // read-only: the mode your terminal claude starts in (~/.claude/settings.json)
  provider?: "claude-code" | "codex" | "opencode" | "cursor"; // the AI agent Vlens drives (lib/providers); unset = Claude Code
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

// ── Vlens Review ──

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
  teams?: string[]; // which of your teams were asked to review ("org/slug")
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

// What Get started checks: the tools Vlens runs, and who they're signed in as.
export interface SetupStatus {
  claude: { installed: boolean; version: string | null };
  account: Account;
  gh: { installed: boolean; user: string | null }; // optional: only Vlens Review needs it
  onboarded: boolean;
}

export interface UpdateInfo {
  current: string;
  latest: string | null; // null until a check succeeds
  available: boolean; // latest is newer than current
  page: string | null; // the release page (notes)
  dmg: string | null; // direct download of the dmg
  checkedAt: string | null;
  error: string | null;
}
