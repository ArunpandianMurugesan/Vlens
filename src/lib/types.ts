// Shared types between the API routes and the UI.

export type Block =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_use"; id: string; name: string; input: unknown }
  | { kind: "tool_result"; toolUseId: string; text: string; isError: boolean }
  | { kind: "image" };

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
